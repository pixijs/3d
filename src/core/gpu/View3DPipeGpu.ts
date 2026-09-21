import { Color, CubeTexture, ExtensionType, Geometry, Rectangle, Shader, State } from 'pixi.js';
import type { InstructionPipe, InstructionSet, Texture, WebGLRenderer, WebGPURenderer } from 'pixi.js';

import { GeometryAtlasPool } from '../../geometry/GeometryAtlasPool';
import { writeLinearRgb } from '../../materials/BaseMaterial3D';
import type { Vector3 } from '../../math/vector/Vector3';
import { updateView3DScene } from '../../scene/utils/updateView3DScene';
import type { View3D } from '../../scene/View3D';
import type { Mesh3DBatch } from '../batcher/Mesh3DBatch';
import type { Mesh3DData } from '../batcher/Mesh3DData';
import type { SortedMesh3DView } from '../batcher/SortedMesh3DView';
import { GeometryDataStoreBuffer } from '../buffers/GeometryDataStoreBuffer';
import { MaterialDataStoreBuffer } from '../buffers/MaterialDataStoreBuffer';
import { MorphStoreBuffer } from '../buffers/MorphStoreBuffer';
import { detectSharedCacheInvalidation } from '../detectSharedCacheInvalidation';
import { generateBrdfLut } from '../ibl/generateBrdfLut';
import { generateIblSpecialCubemap } from '../ibl/generateIblSpecialCubemap';
import type { ColorHandle, DepthHandle } from '../render-graph/ResourceHandle';
import { cachesDrawWork } from '../render-passes/RenderForwardDescriptor';
import type { RenderForwardDescriptor } from '../render-passes/RenderForwardDescriptor';
import type { ReadonlyRect, RenderSession } from '../render-passes/RenderSession';
import { calculateTransparentDistances } from '../render-passes/transparent/transparentSortUtils';
import { View3DGCRegistry } from '../View3DGCRegistry';
import type { GlobalSlots, View3DPipe } from '../View3DPipe';
import { computeForwardBatchesGpu, prepareForwardBatchesGpu, renderForwardBatchesGpu } from './renderForwardBatchesGpu';
import { getGlobalGpuData } from './shader/globalBitGpu';
import { ShadowRenderPassGpu } from './ShadowRenderPassGpu';

/** Fallback fog tint when `Fog.color` is omitted */
const DEFAULT_FOG_COLOR = 0xcccccc;
/** Reused for the per-frame fog sRGB → linear decode; never escapes this module */
const scratchFogColor = new Color();

/**
 * The WebGPU pipe responsible for rendering 3D scenes (View3D)
 *
 * Manages shadow passes, opaque/transparent render passes, and handles integration with PixiJS
 * filters by using a separate depth-enabled render target when rendering inside filter passes.
 * @internal
 */
export class View3DPipeGpu implements View3DPipe, InstructionPipe<View3D> {
  /** @ignore */
  public static extension = {
    type: [ExtensionType.WebGPUPipes],
    name: 'view3d',
  } as const;

  public renderer: WebGPURenderer;

  private _brdfLutTexture?: Texture;

  private _iblEnvironmentMap: Record<number, CubeTexture> = {};

  // Reused per-frame storage for `RenderSession.viewport`; filled when the scene
  // update builds the view camera. One View3D renders at a time, so a single
  // rect is safe.
  private readonly _viewport = new Rectangle();

  // Per-batch distance sort for transparent-style forward passes. Bound once (no per-frame
  // closure allocation); the eye comes from the drawing camera's data, handed in per batch.
  private readonly _sortForwardByDistance = (
    renderables: SortedMesh3DView<Mesh3DData>,
    batch: Mesh3DBatch,
    cameraPosition: Vector3,
  ): void => {
    calculateTransparentDistances(renderables, batch.storeBuffer.data, cameraPosition);
  };

  // Shared material store (centralized for all View3D instances) — owns the
  // rows and the dirty queue in front of them; update() drains then uploads.
  public materialStoreBuffer = new MaterialDataStoreBuffer();

  // Shared morph storage (centralized for all View3D instances): the static
  // delta arena plus every morphed mesh's fixed weight slot, in the one buffer
  // bound at global slot 12. Its presence also flags the GPU pipe so the shared
  // scene update runs the (GPU-only) morph prepare pass — see updateView3DScene.
  public _morphStoreBuffer = new MorphStoreBuffer();

  // Per-geometry data store: sphere + morph facts per row, keyed by
  // _geometryDataIndex — read by the GPU cull compute (sphere texel) and the
  // morph shader bits (morph texel). Populated in updateView3DScene; the GL
  // pipe owns the same store and binds its data-texture view.
  public geometryDataStoreBuffer = new GeometryDataStoreBuffer();

  // Global-bind-group slot indices for pass-sampled resources. WebGPU's separate
  // sampler bindings push texture slots one past the WebGL layout (color 8/depth 7).
  public readonly globalSlots: GlobalSlots = { opaqueColor: 8, opaqueDepth: 7, shadowMap: 5 };

  // Process-wide geometry atlas pool (WebGPU passes baseVertex at draw time, so no
  // index rebasing), keyed by attribute layout and shared across every renderer on this
  // backend. `updateView3DScene` allocates into it.
  public readonly atlasPool = GeometryAtlasPool.from({ rebaseIndices: false });

  // Views this renderer draws, enrolled in pixi's GC so an idle one gives its GPU memory back.
  private readonly _managedViews: View3DGCRegistry;

  // One-time guard: the batched indirect draw path requires non-zero firstInstance in the indirect
  // args, which needs the `indirect-first-instance` WebGPU feature (pixi auto-requests it where the
  // adapter supports it — effectively everywhere WebGPU runs).
  private _indirectChecked = false;

  private _destroyed = false;

  constructor(renderer: WebGLRenderer | WebGPURenderer) {
    // This pipe uses WebGPU-only APIs (encoder/pipeline/bind groups).
    // Pixi's pipe constructor is typed as WebGLRenderer, so we accept the union and cast.
    this.renderer = renderer as WebGPURenderer;
    this._managedViews = new View3DGCRegistry(this.renderer);
  }

  /**
   * Construct the WebGPU shadow pass
   *
   * Shadow is the one pass `createDefaultGraph3D` can't import directly — its cascaded WebGPU
   * and single-layer WebGL forms are different classes — so the pipe builds the right one. The
   * pipe supplies its own renderer; the caller threads the graph's shadow-map handle.
   * @param options - Shadow pass options
   * @param options.shadowMapHandle - The graph's shadow-map handle
   */
  public createShadowPass(options: { shadowMapHandle: DepthHandle }): ShadowRenderPassGpu {
    return new ShadowRenderPassGpu({ renderer: this.renderer, shadowMapHandle: options.shadowMapHandle });
  }

  /**
   * The forward mesh-draw seam
   *
   * Translates the declarative descriptor into the WebGPU mechanism: `sort:'key'` records a
   * reusable render bundle (cache `'auto'`); `sort:'distance'` re-sorts by camera distance and
   * replays the command list every frame (cache `'never'`). `useBundles`/`alwaysRebuild`
   * are exact complements of the resolved cache policy, so the immediate-replay
   * invariant (`useBundles===false` ⇒ `alwaysRebuild===true`) always holds.
   * @param desc - The pass's forward descriptor: bit, sort mode, and cache policy
   * @param session - The current frame's render session
   */
  public renderForward(desc: RenderForwardDescriptor, session: RenderSession): void {
    const useBundles = cachesDrawWork(desc);
    const skipTextureBatching = desc.textures === false;

    if (desc.sort === 'distance') {
      renderForwardBatchesGpu({
        pipe: this,
        bit: desc.bit,
        cullResults: desc.cullResults,
        camera: desc.camera,
        session,
        useBundles,
        alwaysRebuild: !useBundles,
        sortBatch: this._sortForwardByDistance,
        skipTextureBatching,
      });
      return;
    }

    renderForwardBatchesGpu({
      pipe: this,
      bit: desc.bit,
      cullResults: desc.cullResults,
      camera: desc.camera,
      session,
      useBundles,
      alwaysRebuild: !useBundles,
      skipTextureBatching,
    });
  }

  /**
   * Prepare phase (graph pre-sweep): upload the bundled passes' draw buffers before their
   * render pass opens
   *
   * Bundled ⟹ key-sorted (a per-frame distance re-sort can't be cached into a bundle), so
   * there is no sort branch here; immediate-replay (`cache:'never'`) passes return early and
   * prepare inline in `renderForward`.
   * @param desc - The pass's forward descriptor: bit, sort mode, and cache policy
   * @param session - The current frame's render session
   */
  public prepareForward(desc: RenderForwardDescriptor, session: RenderSession): void {
    if (!cachesDrawWork(desc)) return;

    const options = {
      pipe: this,
      bit: desc.bit,
      cullResults: desc.cullResults,
      camera: desc.camera,
      session,
      useBundles: true,
      alwaysRebuild: false,
      skipTextureBatching: desc.textures === false,
    };
    prepareForwardBatchesGpu(options);
    computeForwardBatchesGpu(options);
  }

  /**
   * Draw a single geometry with a shader + state directly (skybox / screen passes)
   * @param geometry - The geometry to draw
   * @param shader - The shader to draw it with
   * @param state - The blend, depth, and culling state for the draw
   */
  public renderGeometry(geometry: Geometry, shader: Shader, state: State): void {
    this.renderer.encoder.draw({ geometry, shader, state });
  }

  /**
   * Narrows the open render pass's viewport (see `View3DPipe.setViewport`)
   * @param viewport - The rect to narrow to, in the bound target's physical pixels
   */
  public setViewport(viewport: ReadonlyRect): void {
    // Pixi's encoder types the rect as a `Rectangle` but reads only its four numbers.
    this.renderer.encoder.setViewport(viewport as Rectangle);
  }

  // Lazily-built fullscreen-triangle resources for clearDepth (one set per pipe,
  // shared across views). WGSL only — this pipe only ever runs on WebGPU.
  private _depthClearGeometry: Geometry | null = null;
  private _depthClearShader: Shader | null = null;
  private _depthClearState: State | null = null;

  public clearDepth(_session: RenderSession): void {
    if (!this._depthClearShader) this._buildDepthClear();
    const { encoder, pipeline } = this.renderer;
    // The executor set the live viewport to this pass's rect, so the triangle's
    // depth write is clipped to it. Colour is masked off — only depth resets.
    pipeline.setColorMask(0);
    encoder.draw({
      geometry: this._depthClearGeometry!,
      shader: this._depthClearShader!,
      state: this._depthClearState!,
    });
    pipeline.setColorMask(0b1111);
  }

  private _buildDepthClear(): void {
    // Oversized triangle covering clip space [-1, 1]^2 — one primitive, no seam.
    this._depthClearGeometry = new Geometry({
      attributes: { aPosition: new Float32Array([-1, -1, 3, -1, -1, 3]) },
    });

    // depthTest false -> depthCompare 'always'; depthMask true -> writes enabled,
    // so every covered pixel's depth becomes the far value (z = w = 1).
    const state = new State();
    state.depthTest = false;
    state.depthMask = true;
    state.culling = false;
    state.blend = false;
    this._depthClearState = state;

    this._depthClearShader = Shader.from({
      gpu: {
        vertex: {
          entryPoint: 'mainVertex',
          source: /* wgsl */ `
            struct VertexOutput { @builtin(position) position: vec4<f32> };

            @vertex
            fn mainVertex(@location(0) aPosition: vec2<f32>) -> VertexOutput {
              var output: VertexOutput;
              // z = w = 1 -> NDC depth 1.0 (far plane).
              output.position = vec4<f32>(aPosition, 1.0, 1.0);
              return output;
            }
          `,
        },
        fragment: {
          entryPoint: 'mainFragment',
          // Depth-clear draws with colour masked off. The fragment still has to
          // return a colour; it is never written.
          source: /* wgsl */ `
            @fragment
            fn mainFragment() -> @location(0) vec4<f32> {
              return vec4<f32>(0.0, 0.0, 0.0, 1.0);
            }
          `,
        },
      },
    });
  }

  public copyColor(handle: ColorHandle, session: RenderSession): void {
    // Copy from the render target the scene just drew into — the currently-bound
    // target, which is the sceneColor/sceneDepth transient in composite mode, or the
    // screen in direct mode (where it equals session.defaultTarget).
    const target = this.renderer.renderTarget.renderTarget;
    if (!target.colorTexture) return;
    const texture = session.view3d._graph._texture(handle, session);
    // WebGPU can't encode a copy inside an open render pass, and its
    // `copyToTexture` doesn't end the pass for us — so close it, copy, then null
    // `activeTarget` so the executor reopens the encoder for the next pass.
    this.renderer.renderTarget.finishRenderPass();
    // Source region = the bound target's viewport (`activeViewport`): the inset's
    // physical position on the screen in direct mode, or [0, vp] in the scene's own
    // transient in composite mode. Destination = the destination texture's own frame.
    const frame = session.activeViewport;
    const dest = texture.frame;
    const resolution = texture.source.resolution;
    this.renderer.renderTarget.copyToTexture(
      target,
      texture,
      { x: frame.x, y: frame.y },
      { width: frame.width, height: frame.height },
      { x: Math.round(dest.x * resolution), y: Math.round(dest.y * resolution) },
    );
    session.activeTarget = null;
  }

  public generateMips(handle: ColorHandle, session: RenderSession): void {
    const source = session.view3d._graph._texture(handle, session).source;
    // Mipmap generation records its own render passes on the frame encoder, and
    // WebGPU forbids beginning one while another is open. Copy producers
    // (CopyOpaquePass) have already closed the pass; blit producers (effect
    // chains) leave theirs open — close it and null `activeTarget` so the
    // executor reopens the target for the next pass.
    this.renderer.renderTarget.finishRenderPass();
    session.activeTarget = null;
    this.renderer.mipChain3d.generate(source);
  }

  public copyDepth(handle: DepthHandle, session: RenderSession): void {
    // Source = the scene's render target (see copyColor).
    const target = this.renderer.renderTarget.renderTarget;
    if (!target.depthStencilTexture) return;
    const texture = session.view3d._graph._texture(handle, session);
    this.renderer.renderTarget.finishRenderPass();
    // Same bound-target frame as copyColor (see there).
    const frame = session.activeViewport;
    this.renderer.renderTarget.copyDepthTexture(
      target,
      texture,
      { x: frame.x, y: frame.y },
      { width: frame.width, height: frame.height },
      { x: 0, y: 0 },
    );
    session.activeTarget = null;
  }

  public validateRenderable(): boolean {
    return false;
  }

  public addRenderable(view3d: View3D, instructionSet: InstructionSet) {
    const batcher = this.renderer.renderPipes.batch;
    batcher.break(instructionSet);

    instructionSet.add(view3d);
  }

  public updateRenderable() {}

  public execute(view3d: View3D) {
    if (!view3d.isRenderable) return;

    if (!this._indirectChecked) {
      this._indirectChecked = true;
      if (!this.renderer.gpu.device.features.has('indirect-first-instance')) {
        throw new Error(
          "@pixi/3d requires the WebGPU 'indirect-first-instance' feature (used by the batched indirect draw path).",
        );
      }
    }

    view3d._ensureInitialized(this.renderer);

    const gpuData = getGlobalGpuData(view3d, this.renderer);

    this._managedViews.track(view3d);

    const env = view3d.environment;

    // The BRDF lookup is shared by the renderer and created on its first environment use.
    // A view's binding slots start with placeholders that are safe for zero-radiance sampling.
    if (env) {
      this._brdfLutTexture ||= generateBrdfLut({
        renderer: this.renderer,
        size: 512,
      });
      gpuData.globalBindGroup.setResource(this._brdfLutTexture.source, 3);

      // A hemisphere needs only the lookup. Each cubemap source gets one prefiltered cube.
      if (env instanceof CubeTexture) {
        const sourceId = env.source.uid;
        if (!this._iblEnvironmentMap[sourceId]) {
          this._iblEnvironmentMap[sourceId] = generateIblSpecialCubemap({
            renderer: this.renderer,
            sourceTexture: env,
            size: 256,
            sampleCount: 1024,
          });
        }
        gpuData.globalBindGroup.setResource(this._iblEnvironmentMap[sourceId].source, 2);
      }
    }

    const lights = view3d.lights;
    if (view3d._meshSlots.count === 0 && view3d._meshBatches.length === 1) return;

    const renderSession: RenderSession = {
      view3d,
      lights,
      defaultTarget: this.renderer.renderTarget.renderTarget,
      activeTarget: null,
      needsDepthClear: true,
      viewport: this._viewport,
      activeViewport: this._viewport,
      globalBindGroup: gpuData.globalBindGroup,
      renderer: this.renderer,
    };

    if (!updateView3DScene(view3d, this, renderSession)) return;

    // Bind bonePit + morph store + material store buffer after the scene update has finalised them,
    // then upload the material store (its version is read below to detect a rewrite this frame).
    // Re-binding the pits each frame captures any buffer reallocation from this frame's growth.
    gpuData.globalBindGroup.setResource(view3d._bonePit.bufferResource, 11);
    gpuData.globalBindGroup.setResource(this._morphStoreBuffer.bufferResource, 12);
    gpuData.globalBindGroup.setResource(this.geometryDataStoreBuffer.bufferResource, 13);
    gpuData.globalBindGroup.setResource(this.materialStoreBuffer.bufferResource, 14);
    this.materialStoreBuffer.update();
    this.geometryDataStoreBuffer.update();
    this.atlasPool.update();

    // Reconcile the per-pass draw caches against shared resources: a store/atlas realloc
    // invalidates every recorded command. Target-shape staleness (attachment state, winding)
    // needs no check here — recorded bundles carry a stamp of the state they baked, and the
    // passes vet it with `encoder.isBundleValid` at each replay site.
    if (
      detectSharedCacheInvalidation(
        this.atlasPool,
        this.materialStoreBuffer,
        gpuData,
        this._morphStoreBuffer,
        this.geometryDataStoreBuffer,
      )
    ) {
      view3d._invalidateDrawCaches();
    }

    this.prepareView(renderSession);
    view3d._graph.run(renderSession);
  }

  /**
   * Release every renderer-scoped GPU resource this pipe owns
   *
   * Invoked by `renderer.destroy()` through the `destroy` runner, so the renderer (and its
   * device) is going away with us; all of these are exclusively owned and freed
   * unconditionally. Idempotent: a second call is a no-op.
   */
  public destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    // Each enrolled View's global bind group for this renderer goes first, before the LUT,
    // environment maps and stores it binds are destroyed.
    this._managedViews.destroy();

    this._brdfLutTexture?.destroy(true);
    this._brdfLutTexture = undefined;

    for (const sourceId in this._iblEnvironmentMap) this._iblEnvironmentMap[sourceId].destroy(true);
    this._iblEnvironmentMap = {};

    // `atlasPool` outlives this renderer by design; see `GeometryAtlasPool.from`.

    this.materialStoreBuffer.destroy();
    this._morphStoreBuffer.destroy();
    this.geometryDataStoreBuffer.destroy();

    this._depthClearGeometry?.destroy(true);
    this._depthClearGeometry = null;
    this._depthClearShader?.destroy();
    this._depthClearShader = null;
    this._depthClearState = null;
  }

  /**
   * Readies the view for this frame (see `View3DPipe.prepareView`)
   * @param session - The frame's render session
   */
  public prepareView(session: RenderSession): void {
    const { view3d, lights } = session;

    this.renderer.lighting3d.update(view3d, lights);
    this._updateGlobalUniforms(view3d);
  }

  private _updateGlobalUniforms(view3d: View3D): void {
    const { fog } = view3d;

    const gpuData = getGlobalGpuData(view3d, this.renderer);
    const globalUniformGroup = gpuData.globalUniformGroup;
    const globalUniforms = globalUniformGroup.uniforms;

    globalUniforms.uTime = performance.now() / 1000;
    globalUniforms.uExposure = view3d.exposure;

    // Fog mixes in linear light before the tone curve, so the authored sRGB
    // colour is decoded and scaled by exposure here rather than per fragment.
    // Rewritten every frame while fog is on: exposure can move even when the
    // colour has not.
    if (fog) {
      scratchFogColor.setValue(fog.color ?? DEFAULT_FOG_COLOR);
      writeLinearRgb(globalUniforms.uFogColor as Float32Array, 0, scratchFogColor, view3d.exposure);
      const fogParams = globalUniforms.uFogParams as Float32Array;
      fogParams[0] = fog.near || 0;
      fogParams[1] = fog.far || 99999999;
      fogParams[2] = fog.density || 0;
    }

    // Mark dirty then force the CPU→GPU upload immediately.
    // Render bundles execute without _syncBindGroup so the buffer must
    // contain the current frame's values before any pass runs.
    globalUniformGroup.update();
    this.renderer.ubo.updateUniformGroup(globalUniformGroup);
  }
}

declare global {
  namespace PixiMixins {
    interface WebGPUPipes {
      /** The 3D scene pipe — types `renderer.renderPipes.view3d` on WebGPU renderers */
      view3d: View3DPipeGpu;
    }
  }
}
