import { CLEAR, Color, CubeTexture, ExtensionType, Rectangle, State } from 'pixi.js';
import type { Geometry, InstructionPipe, InstructionSet, Shader, Texture, WebGLRenderer } from 'pixi.js';

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
import {
  calculateDistancesFromStore,
  calculateDistancesFromWorldMatrix,
} from '../render-passes/transparent/transparentSortUtils';
import { View3DGCRegistry } from '../View3DGCRegistry';
import type { GlobalSlots, View3DPipe } from '../View3DPipe';
import { renderForwardBatchesGl } from './renderForwardBatchesGl';
import { getGlobalGlData } from './shader/globalBitGl';
import { ShadowRenderPassGl } from './ShadowRenderPassGl';

/** Fallback fog tint when `Fog.color` is omitted */
const DEFAULT_FOG_COLOR = 0xcccccc;
/** Reused for the per-frame fog sRGB → linear decode; never escapes this module */
const scratchFogColor = new Color();

/**
 * The WebGL instruction pipe that renders 3D scenes (View3D)
 *
 * Manages shadow passes, opaque/transparent render passes, and handles integration with PixiJS
 * filters by using a separate depth-enabled render target when rendering inside filter passes.
 * @internal
 */
export class View3DPipeGl implements View3DPipe, InstructionPipe<View3D> {
  /** @ignore */
  public static extension = {
    type: [ExtensionType.WebGLPipes],
    name: 'view3d',
  } as const;

  public renderer: WebGLRenderer;

  private _brdfLutTexture?: Texture;

  private _destroyed = false;

  private _iblEnvironmentMap: Record<number, CubeTexture> = {};

  // Reused per-frame storage for `RenderSession.viewport`; filled when the scene
  // update builds the view camera. One View3D renders at a time, so a single
  // rect is safe.
  private readonly _viewport = new Rectangle();

  // Per-batch distance sort for transparent-style passes. Bound once (no per-frame closure
  // allocation); the eye comes from the drawing camera's data, handed in per batch. Batched
  // (store-backed) and scene meshes take different distance paths — the WebGPU pipe has only
  // the store-backed case.
  private readonly _sortForwardByDistance = (
    renderables: SortedMesh3DView<Mesh3DData>,
    batch: Mesh3DBatch,
    cameraPosition: Vector3,
  ): void => {
    if (batch.isUserBatch) {
      calculateDistancesFromStore(renderables, cameraPosition, batch.storeBuffer.data, batch.renderData.worldTransform);
    } else {
      calculateDistancesFromWorldMatrix(renderables, cameraPosition);
    }
  };

  // Shared material store (centralized for all View3D instances) — owns the
  // rows and the dirty queue in front of them; update() drains then uploads.
  public materialStoreBuffer = new MaterialDataStoreBuffer();

  // Shared morph storage (centralized for all View3D instances) — same
  // backend-neutral store the WebGPU pipe owns; WebGL binds its data-texture
  // view, read by the GL morph bits.
  public _morphStoreBuffer = new MorphStoreBuffer();

  // Per-geometry data store (sphere + morph facts) — same store the WebGPU
  // pipe owns; WebGL binds its data-texture view. Only the morph texel is ever
  // read here (GPU frustum culling is WebGPU-only; the sphere texel is dead
  // weight worth kilobytes for a layout that cannot drift per backend).
  public geometryDataStoreBuffer = new GeometryDataStoreBuffer();

  // Global-bind-group slot indices for pass-sampled resources. WebGL has no
  // separate sampler bindings, so texture slots sit one below WebGPU (color 7/depth 6).
  public readonly globalSlots: GlobalSlots = { opaqueColor: 7, opaqueDepth: 6, shadowMap: 4 };

  // Process-wide geometry atlas pool (rebased indices for WebGL), keyed by attribute
  // layout and shared across every renderer on this backend. `updateView3DScene` allocates
  // into it.
  public readonly atlasPool = GeometryAtlasPool.from({ rebaseIndices: true });

  // Views this renderer draws, enrolled in pixi's GC so an idle one gives its GPU memory back.
  private readonly _managedViews: View3DGCRegistry;

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this._managedViews = new View3DGCRegistry(renderer);
  }

  /**
   * Constructs the WebGL shadow pass (single-layer; cascaded parity is a separate follow-up)
   *
   * See `View3DPipeGpu.createShadowPass`.
   * @param options - Shadow pass options
   * @param options.shadowMapHandle - The graph's shadow-map handle
   * @returns The pass, ready for graph registration
   */
  public createShadowPass(options: { shadowMapHandle: DepthHandle }): ShadowRenderPassGl {
    return new ShadowRenderPassGl({ renderer: this.renderer, shadowMapHandle: options.shadowMapHandle });
  }

  /**
   * WebGL keeps all forward work in `renderForward`; the prepare phase is a no-op
   * @param _desc - The pass's forward descriptor, unused here
   * @param _session - The current frame's render session, unused here
   */
  public prepareForward(_desc: RenderForwardDescriptor, _session: RenderSession): void {}

  /**
   * The forward mesh-draw seam: translates the declarative descriptor into the WebGL mechanism
   *
   * WebGL always uses a persistent instance buffer; cache `'auto'` (`sort:'key'`) keeps a
   * slot-map for in-place transform patches, cache `'never'` (`sort:'distance'`) rebuilds every
   * frame after re-sorting by camera distance.
   * @param desc - The pass's forward descriptor: bit, sort mode, and cache policy
   * @param session - The current frame's render session
   */
  public renderForward(desc: RenderForwardDescriptor, session: RenderSession): void {
    const alwaysRebuild = !cachesDrawWork(desc);
    const skipTextureBatching = desc.textures === false;

    if (desc.sort === 'distance') {
      renderForwardBatchesGl({
        pipe: this,
        bit: desc.bit,
        camera: desc.camera,
        session,
        alwaysRebuild,
        sortBatch: this._sortForwardByDistance,
        skipTextureBatching,
      });
      return;
    }

    renderForwardBatchesGl({
      pipe: this,
      bit: desc.bit,
      camera: desc.camera,
      session,
      alwaysRebuild,
      skipTextureBatching,
    });
  }

  /**
   * Draws a single geometry with a shader + state directly (skybox / screen passes)
   * @param geometry - The geometry to draw
   * @param shader - The shader to draw it with
   * @param state - The blend, depth, and culling state for the draw
   */
  public renderGeometry(geometry: Geometry, shader: Shader, state: State): void {
    this.renderer.encoder.draw({ geometry, shader, state });
  }

  /**
   * Narrows the GL viewport (see `View3DPipe.setViewport`)
   *
   * Straight to `gl.viewport`: pixi's adaptor only sets it from a target bind, and going
   * through `bind` would tear down and re-begin the pass.
   * @param viewport - The rect to narrow to, in the bound target's physical pixels
   */
  public setViewport(viewport: ReadonlyRect): void {
    this.renderer.gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
  }

  /** Depth-writable state so `gl.clear(DEPTH)` isn't masked by 2D's `depthMask: false` */
  private _depthClearState: State | null = null;

  public clearDepth(session: RenderSession): void {
    if (!this._depthClearState) {
      const state = new State();
      state.depthMask = true;
      state.depthTest = false;
      state.culling = false;
      state.blend = false;
      this._depthClearState = state;
    }
    const gl = this.renderer.gl;
    const vp = session.activeViewport;
    // Enable depth writes (2D left them off) via the state system so the cache
    // stays coherent, then scissor the depth clear to the live GPU rect.
    this.renderer.state.set(this._depthClearState);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(vp.x, vp.y, vp.width, vp.height);
    // The live target: the screen in direct mode, the scene transient when a camera pass resets
    // its own rect inside a composite frame. `gl.clear` hits whatever is bound either way.
    this.renderer.renderTarget.clear(this.renderer.renderTarget.renderTarget, CLEAR.DEPTH);
    gl.disable(gl.SCISSOR_TEST);
  }

  public copyColor(handle: ColorHandle, session: RenderSession): void {
    // Copy from the render target the scene just drew into — the currently-bound
    // target, which is the sceneColor/sceneDepth transient in composite mode, or the
    // screen in direct mode (where it equals session.defaultTarget).
    const target = this.renderer.renderTarget.renderTarget;
    if (!target.colorTexture) return;

    const texture = session.view3d._graph._texture(handle, session);
    // WebGL's copyToTexture ends the (MSAA-resolving) pass internally and has no
    // encoder to reopen — so no finishRenderPass / activeTarget bracketing.
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
  }

  public generateMips(handle: ColorHandle, session: RenderSession): void {
    const source = session.view3d._graph._texture(handle, session).source;
    // gl.generateMipmap cannot run on a texture that is the live colour attachment.
    // finishRenderPass is a no-op without MSAA, so unbind by binding the view's target.
    this.renderer.renderTarget.bind({ target: session.defaultTarget, clear: CLEAR.NONE });
    session.activeTarget = null;
    source.updateMipmaps();
  }

  public copyDepth(handle: DepthHandle, session: RenderSession): void {
    // Source = the scene's render target (see copyColor).
    const target = this.renderer.renderTarget.renderTarget;
    if (!target.depthStencilTexture) return;
    const texture = session.view3d._graph._texture(handle, session);
    // Same bound-target frame as copyColor (see there).
    const frame = session.activeViewport;
    this.renderer.renderTarget.copyDepthTexture(
      target,
      texture,
      { x: frame.x, y: frame.y },
      { width: frame.width, height: frame.height },
      { x: 0, y: 0 },
    );
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

    view3d._ensureInitialized(this.renderer);

    const glData = getGlobalGlData(view3d, this.renderer);

    this._managedViews.track(view3d);

    this._brdfLutTexture ||= generateBrdfLut({
      renderer: this.renderer,
      size: 512,
    });
    glData.globalBindGroup.setResource(this._brdfLutTexture!.source, 2);

    // IBL only applies to cubemap environments; a Hemisphere fill contributes
    // through its own env-source bit, not the prefiltered specular cubemap.
    const env = view3d.environment;
    const ibl = env instanceof CubeTexture ? env : null;
    if (ibl) {
      const sourceId = ibl.source.uid;
      if (!this._iblEnvironmentMap[sourceId]) {
        this._iblEnvironmentMap[sourceId] = generateIblSpecialCubemap({
          renderer: this.renderer,
          sourceTexture: ibl,
          size: 256,
          sampleCount: 1024,
        });
      }
      glData.globalBindGroup.setResource(this._iblEnvironmentMap[sourceId].source, 1);
      // WebGPU uses (mipLevelCount - 1) for the max mip index; match that here.
      glData.globalUniformGroup.uniforms.uEnvironmentMaxMipLevel =
        this._iblEnvironmentMap[sourceId].source.mipLevelCount - 1;
    }

    const lights = view3d.lights;
    if (view3d._meshSlots.count === 0 && view3d._meshBatches.length === 1) return;

    const renderSession: RenderSession = {
      view3d: view3d,
      lights,
      defaultTarget: this.renderer.renderTarget.renderTarget,
      activeTarget: null,
      needsDepthClear: true,
      viewport: this._viewport,
      activeViewport: this._viewport,
      globalBindGroup: glData.globalBindGroup,
      globalUniformGroup: glData.globalUniformGroup,
      renderer: this.renderer,
    };

    if (!updateView3DScene(view3d, this, renderSession)) return;

    // Bind bonePit + morph store now that the scene update has finalised bone matrices.
    // Re-binding each frame captures any buffer reallocation from growth.
    glData.globalBindGroup.setResource(view3d._bonePit.texture.source, 5);
    glData.globalBindGroup.setResource(this._morphStoreBuffer.texture.source, 8);
    glData.globalBindGroup.setResource(this.geometryDataStoreBuffer.texture.source, 9);

    // Upload dirty atlas + material-store ranges, then force a full rebuild if
    // either shared buffer was reallocated (cached draw state is stale). See
    // `detectSharedCacheInvalidation`.
    this.atlasPool.update();
    this.materialStoreBuffer.update();
    this.geometryDataStoreBuffer.update();

    // The morph store joins the compare because GL instance records bake each
    // mesh's weight offset — arena growth shifts every slot, so records must
    // rebuild. (The store's data texture itself re-binds every frame; the
    // geometry store needs no member here — its indices never move.)
    if (detectSharedCacheInvalidation(this.atlasPool, this.materialStoreBuffer, glData, this._morphStoreBuffer)) {
      view3d._invalidateDrawCaches();
    }

    glData.globalBindGroup.setResource(this.materialStoreBuffer.texture.source, 3);

    this.prepareView(renderSession);
    view3d._graph.run(renderSession);
  }

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
    const glData = getGlobalGlData(view3d, this.renderer);

    const globalUniforms = glData.globalUniformGroup.uniforms;

    globalUniforms.uTime = performance.now() / 1000;
    globalUniforms.uExposure = view3d.exposure;

    // See WebGPU counterpart — linear light, premultiplied by exposure.
    if (fog) {
      scratchFogColor.setValue(fog.color ?? DEFAULT_FOG_COLOR);
      writeLinearRgb(globalUniforms.uFogColor as Float32Array, 0, scratchFogColor, view3d.exposure);
      const fogParams = globalUniforms.uFogParams as Float32Array;
      fogParams[0] = fog.near || 0;
      fogParams[1] = fog.far || 99999999;
      fogParams[2] = fog.density || 0;
    }

    glData.globalUniformGroup.update();
  }
}

declare global {
  namespace PixiMixins {
    interface WebGLPipes {
      /** The 3D scene pipe — types `renderer.renderPipes.view3d` on WebGL renderers */
      view3d: View3DPipeGl;
    }
  }
}
