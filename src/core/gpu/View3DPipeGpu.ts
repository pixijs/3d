import { Color, CubeTexture, ExtensionType, Rectangle, Shader, State } from 'pixi.js';
import type { Geometry, InstructionPipe, InstructionSet, Texture, WebGLRenderer, WebGPURenderer } from 'pixi.js';

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
import { fullscreenTriangleGeometry } from '../fullscreenTriangleGeometry';
import { generateBrdfLut } from '../ibl/generateBrdfLut';
import { generateIblSpecialCubemap } from '../ibl/generateIblSpecialCubemap';
import type { DrawTarget } from '../render-graph/RenderGraph';
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
 * The WebGPU instruction pipe that renders each View3D
 *
 * Each frame it updates the view's scene, packs its lights and global uniforms, and runs its
 * render graph. It owns what every view on the renderer shares: the material, morph and
 * per-geometry stores, the BRDF table and the prefiltered environment maps. The passes draw
 * through it as their `View3DPipe`.
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

  /**
   * Storage for `RenderSession.viewport`, filled when the scene update builds the view camera;
   * one rect serves every view because views render one at a time
   */
  private readonly _viewport = new Rectangle();

  /**
   * The per-batch sort of the distance-sorted forward passes, bound once so a frame allocates no
   * closure
   * @param renderables - The batch's draw list for the pass
   * @param batch - The batch whose store holds the instances' matrices
   * @param cameraPosition - The drawing camera's eye
   */
  private readonly _sortForwardByDistance = (
    renderables: SortedMesh3DView<Mesh3DData>,
    batch: Mesh3DBatch,
    cameraPosition: Vector3,
  ): void => {
    calculateTransparentDistances(renderables, batch.storeBuffer.data, cameraPosition);
  };

  /** The renderer's material rows, shared by every view, with the dirty queue in front of them */
  public materialStoreBuffer = new MaterialDataStoreBuffer();

  /** The renderer's morph deltas and weights, shared by every view and bound at global slot 13 */
  public _morphStoreBuffer = new MorphStoreBuffer();

  /**
   * The renderer's per-geometry rows, shared by every view: the bounding sphere the cull compute
   * reads, and the morph facts the morph bits read
   */
  public geometryDataStoreBuffer = new GeometryDataStoreBuffer();

  /** This backend's bindings for the textures passes sample; `globalBitGpu` lists the whole group */
  public readonly globalSlots: GlobalSlots = { opaqueColor: 8, opaqueDepth: 7, shadowMap: 5 };

  /**
   * The process-wide atlas pool for WebGPU's packing, which keeps indices geometry-local because
   * each draw passes its `baseVertex`; `GeometryAtlasPool.from` says why no renderer owns it
   */
  public readonly atlasPool = GeometryAtlasPool.from({ rebaseIndices: false });

  /** Views this renderer draws, enrolled in pixi's GC so an idle one gives its GPU memory back */
  private readonly _managedViews: View3DGCRegistry;

  /**
   * Whether `execute` has checked the device for the `indirect-first-instance` feature
   *
   * The batched indirect draws start most commands at a non-zero `firstInstance`, and without the
   * feature WebGPU treats such a draw as a no-op. pixi requests the feature whenever the adapter
   * has it.
   */
  private _indirectChecked = false;

  private _destroyed = false;

  /**
   * Takes the renderer union pixi constructs every pipe with; only a WebGPU renderer builds this one
   * @param renderer - The WebGPU renderer this pipe serves
   */
  constructor(renderer: WebGLRenderer | WebGPURenderer) {
    this.renderer = renderer as WebGPURenderer;
    this._managedViews = new View3DGCRegistry(this.renderer);
  }

  /**
   * Construct the WebGPU shadow pass
   *
   * The shadow pass is the one default pass with a class per backend, and `createDefaultGraph3D`
   * can't import either without bundling that backend, so the pipe builds it. The pipe supplies
   * its own renderer; the caller passes the graph's shadow-map handle.
   * @param options - Shadow pass options
   * @param options.shadowMapHandle - The graph's shadow-map handle
   */
  public createShadowPass(options: { shadowMapHandle: DepthHandle }): ShadowRenderPassGpu {
    return new ShadowRenderPassGpu({ renderer: this.renderer, shadowMapHandle: options.shadowMapHandle });
  }

  /**
   * The forward mesh-draw seam
   *
   * A pass that caches its draws (`cachesDrawWork`, the default for `sort: 'key'`) replays a
   * render bundle. One that doesn't, the default for `sort: 'distance'`, re-sorts by camera
   * distance and replays its command list every frame. `useBundles` and `alwaysRebuild` are
   * always complements, as `renderForwardBatchesGpu` requires.
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
   * Prepare phase (graph pre-sweep): build and upload the cached passes' draw data and run their
   * culls before their render pass opens
   *
   * Only passes that cache their draws get here, and they sort by key: a sort by camera distance
   * changes every frame, so a bundle can't keep it. A pass declaring `sort: 'distance'` with
   * `cache: 'auto'` would therefore draw in key order. Passes that don't cache return early and
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
   * Draw a single geometry with a shader + state directly (the background pass, post effects)
   * @param geometry - The geometry to draw
   * @param shader - The shader to draw it with
   * @param state - The blend, depth, and culling state for the draw
   */
  public renderGeometry(geometry: Geometry, shader: Shader, state: State): void {
    this.renderer.encoder.draw({ geometry, shader, state });
  }

  /**
   * Narrows the open render pass's viewport (see `View3DPipe.setViewport`)
   *
   * pixi's encoder types the rect as a `Rectangle` but reads only its four numbers.
   * @param viewport - The rect to narrow to, in the bound target's physical pixels
   */
  public setViewport(viewport: ReadonlyRect): void {
    this.renderer.encoder.setViewport(viewport as Rectangle);
  }

  /** The shader `clearDepth` draws with, built on first use and shared by every view */
  private _depthClearShader: Shader | null = null;
  private _depthClearState: State | null = null;

  /**
   * Resets depth by drawing a fullscreen triangle at the far plane with colour writes masked off
   *
   * The executor has already set the live viewport to the pass's rect, which clips the triangle.
   * @param _session - Unused; the live viewport already bounds the clear
   */
  public clearDepth(_session: RenderSession): void {
    if (!this._depthClearShader) this._buildDepthClear();
    const { encoder, pipeline } = this.renderer;
    pipeline.setColorMask(0);
    encoder.draw({
      geometry: fullscreenTriangleGeometry(),
      shader: this._depthClearShader!,
      state: this._depthClearState!,
    });
    pipeline.setColorMask(0b1111);
  }

  /**
   * Builds the depth clear's state and shader
   *
   * `depthTest: false` makes pixi compare with `'always'` and `depthMask: true` keeps depth
   * writes on, so every covered pixel takes the triangle's depth. The vertex shader puts the
   * triangle at `z = w = 1`, the far plane. The fragment shader must return a colour even though
   * the colour mask discards it.
   */
  private _buildDepthClear(): void {
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
              output.position = vec4<f32>(aPosition, 1.0, 1.0);
              return output;
            }
          `,
        },
        fragment: {
          entryPoint: 'mainFragment',
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

  /**
   * Copies the colour (see `View3DPipe.copyColor`)
   *
   * WebGPU can't copy inside an open render pass, so the pass is closed first; pixi's
   * `copyToTexture` would close it too. No pass is open afterwards, so `activeTarget` is nulled
   * and the executor opens one for whatever draws next.
   * @param source - The camera's draw target to copy from
   * @param dest - The texture whose frame receives the copy
   * @param session - The frame's render session
   */
  public copyColor(source: DrawTarget, dest: Texture, session: RenderSession): void {
    const { target, viewport } = source;
    if (!target.colorTexture) return;
    this.renderer.renderTarget.finishRenderPass();
    const frame = dest.frame;
    const resolution = dest.source.resolution;
    this.renderer.renderTarget.copyToTexture(
      target,
      dest,
      { x: viewport.x, y: viewport.y },
      { width: viewport.width, height: viewport.height },
      { x: Math.round(frame.x * resolution), y: Math.round(frame.y * resolution) },
    );
    session.activeTarget = null;
  }

  /**
   * Fills the mip chain (see `View3DPipe.generateMips`)
   *
   * `MipChainSystemGpu` records its own render passes on the frame encoder, and WebGPU can't begin
   * one while another is open. A copy has already closed the pass, but an effect that drew the
   * texture leaves its pass open, so this closes it and nulls `activeTarget` for the executor to
   * reopen the target for the next pass.
   * @param handle - The colour whose mips to fill from level 0
   * @param session - The frame's render session
   */
  public generateMips(handle: ColorHandle, session: RenderSession): void {
    const source = session.view3d._graph._texture(handle, session).source;
    this.renderer.renderTarget.finishRenderPass();
    session.activeTarget = null;
    this.renderer.mipChain3d.generate(source);
  }

  /**
   * Copies the depth (see `View3DPipe.copyDepth`), closing the pass and nulling `activeTarget` as
   * `copyColor` does
   * @param source - The camera's draw target to copy from
   * @param dest - The depth texture that receives the copy
   * @param session - The frame's render session
   */
  public copyDepth(source: DrawTarget, dest: Texture, session: RenderSession): void {
    const { target, viewport } = source;
    if (!target.depthStencilTexture) return;
    this.renderer.renderTarget.finishRenderPass();
    this.renderer.renderTarget.copyDepthTexture(
      target,
      dest,
      { x: viewport.x, y: viewport.y },
      { width: viewport.width, height: viewport.height },
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

  /**
   * Renders one View3D: updates its scene, settles the shared stores, then runs its graph
   *
   * The BRDF table is the renderer's, made the first time any view has an environment, and each
   * cubemap source gets one prefiltered cube. Until a view has an environment its slots hold
   * placeholders that are safe to sample as zero light. A hemisphere needs only the table.
   *
   * A view with no meshes and no batched meshes returns before its scene update, so its graph
   * never runs and it draws nothing, not even its background.
   *
   * After the scene update, the stores are re-bound every frame, so a buffer or texture this
   * frame's growth replaced is the one bound. Then the material and geometry stores and the atlas
   * pool upload, and `detectSharedCacheInvalidation` drops every recorded draw if a store or atlas
   * buffer was replaced. A change of target (attachment formats, sample count, winding) needs no
   * check here: a bundle carries a stamp of the state it baked, and each pass checks it with
   * `encoder.isBundleValid` before replaying.
   * @param view3d - The view to render
   */
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

    if (env) {
      this._brdfLutTexture ||= generateBrdfLut({
        renderer: this.renderer,
        size: 512,
      });
      gpuData.globalBindGroup.setResource(this._brdfLutTexture.source, 3);

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

    gpuData.globalBindGroup.setResource(this.materialStoreBuffer.texture.source, 9);
    gpuData.globalBindGroup.setResource(view3d._bonePit.bufferResource, 12);
    gpuData.globalBindGroup.setResource(this._morphStoreBuffer.bufferResource, 13);
    gpuData.globalBindGroup.setResource(this.geometryDataStoreBuffer.bufferResource, 14);
    this.materialStoreBuffer.update();
    this.geometryDataStoreBuffer.update();
    this.atlasPool.update();

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
   *
   * The enrolled views' global bind groups go first, before the BRDF table, environment maps and
   * stores they bind. `atlasPool` is left alone: it outlives the renderer by design.
   */
  public destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    this._managedViews.destroy();

    this._brdfLutTexture?.destroy(true);
    this._brdfLutTexture = undefined;

    for (const sourceId in this._iblEnvironmentMap) this._iblEnvironmentMap[sourceId].destroy(true);
    this._iblEnvironmentMap = {};

    this.materialStoreBuffer.destroy();
    this._morphStoreBuffer.destroy();
    this.geometryDataStoreBuffer.destroy();

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

  /**
   * Writes the view's time, exposure and fog into its global uniforms and uploads them
   *
   * The fog colour is decoded to linear and scaled by exposure here, once, rather than per
   * fragment (`uFogColor` says why), and rewritten every frame while fog is on, since exposure can
   * change when the colour doesn't. The upload happens here because render bundles replay without
   * pixi's per-draw bind-group sync, and the group is static, so pixi uploads it only after
   * `update()` marks it dirty.
   * @param view3d - The view whose uniforms to write
   */
  private _updateGlobalUniforms(view3d: View3D): void {
    const { fog } = view3d;

    const gpuData = getGlobalGpuData(view3d, this.renderer);
    const globalUniformGroup = gpuData.globalUniformGroup;
    const globalUniforms = globalUniformGroup.uniforms;

    globalUniforms.uTime = performance.now() / 1000;
    globalUniforms.uExposure = view3d.exposure;

    if (fog) {
      scratchFogColor.setValue(fog.color ?? DEFAULT_FOG_COLOR);
      writeLinearRgb(globalUniforms.uFogColor, 0, scratchFogColor, view3d.exposure);
      const fogParams = globalUniforms.uFogParams;
      fogParams[0] = fog.near || 0;
      fogParams[1] = fog.far || 99999999;
      fogParams[2] = fog.density || 0;
    }

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
