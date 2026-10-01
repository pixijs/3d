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
import type { DrawTarget } from '../render-graph/RenderGraph';
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
 * Each frame, `execute` updates the view's scene, binds and uploads the stores shared by every
 * view on this renderer, readies the lights and global uniforms, and runs the view's render graph
 * into whatever target pixi has bound. It also implements `View3DPipe`, the backend calls the
 * passes make.
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

  /**
   * Reused per-frame storage for `RenderSession.viewport`, filled when the scene update builds the
   * view camera; one View3D renders at a time, so a single rect is safe
   */
  private readonly _viewport = new Rectangle();

  /**
   * Per-batch distance sort for transparent-style passes
   *
   * Bound once, so no closure is allocated per frame; the eye comes from the drawing camera's data,
   * handed in per batch. A user batch reads positions from its store; scene meshes read their
   * world matrices. The WebGPU pipe has only the store path.
   * @param renderables - The batch's sorted view
   * @param batch - The batch being sorted
   * @param cameraPosition - The drawing camera's world position
   */
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

  /**
   * The material store shared by every View3D this renderer draws: the rows and the queue of dirty
   * materials in front of them, which `update()` drains and uploads
   */
  public materialStoreBuffer = new MaterialDataStoreBuffer();

  /**
   * The morph store shared by every View3D this renderer draws, the same store the WebGPU pipe
   * owns; WebGL binds its data texture for the morph bits
   */
  public _morphStoreBuffer = new MorphStoreBuffer();

  /**
   * The per-geometry data store, the same store the WebGPU pipe owns; WebGL binds its data texture
   *
   * WebGL reads only each row's morph texel. The bounds texel serves WebGPU's GPU culling; keeping
   * it here costs a few kilobytes and leaves both backends one layout that can't drift apart.
   */
  public geometryDataStoreBuffer = new GeometryDataStoreBuffer();

  /** Must match the slots `getGlobalGlData` gives these textures */
  public readonly globalSlots: GlobalSlots = { opaqueColor: 7, opaqueDepth: 6, shadowMap: 4 };

  /**
   * The process-wide geometry atlas pool for WebGL, which bakes base vertices into the indices;
   * `updateView3DScene` allocates into it
   */
  public readonly atlasPool = GeometryAtlasPool.from({ rebaseIndices: true });

  /** Views this renderer draws, enrolled in pixi's GC so an idle one gives its GPU memory back */
  private readonly _managedViews: View3DGCRegistry;

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this._managedViews = new View3DGCRegistry(renderer);
  }

  /**
   * Constructs the WebGL shadow pass
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
   * A pass that caches draw work (`'key'` sort by default) keeps each batch's command list and
   * instance index until its draw list goes stale. One that doesn't (`'distance'` sort by default)
   * rebuilds every frame after re-sorting by camera distance.
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

  /**
   * See `View3DPipe.clearDepth`
   *
   * Turns depth writes on through pixi's state system, which 2D leaves off, so its state cache
   * stays coherent, then scissors the clear to the live GPU rect. The clear hits whatever is bound:
   * the screen in direct mode, or the scene transient when a camera pass resets its own rect inside
   * a composite frame.
   * @param session - The frame's render session
   */
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
    this.renderer.state.set(this._depthClearState);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(vp.x, vp.y, vp.width, vp.height);
    this.renderer.renderTarget.clear(this.renderer.renderTarget.renderTarget, CLEAR.DEPTH);
    gl.disable(gl.SCISSOR_TEST);
  }

  /**
   * See `View3DPipe.copyColor`
   *
   * Pixi's `copyToTexture` resolves a multisampled source before it reads, so there's no
   * `finishRenderPass` here.
   * @param source - The camera's draw target
   * @param dest - The texture to copy into
   * @param session - The frame's render session
   */
  public copyColor(source: DrawTarget, dest: Texture, session: RenderSession): void {
    const { target, viewport } = source;
    if (!target.colorTexture) return;
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
   * See `View3DPipe.generateMips`
   *
   * Binds the view's own target first, so the texture is no longer the bound colour attachment when
   * pixi regenerates its mips; `finishRenderPass` wouldn't unbind it, as it does nothing without
   * MSAA.
   * @param handle - The colour whose mips are regenerated
   * @param session - The frame's render session
   */
  public generateMips(handle: ColorHandle, session: RenderSession): void {
    const source = session.view3d._graph._texture(handle, session).source;
    this.renderer.renderTarget.bind({ target: session.defaultTarget, clear: CLEAR.NONE });
    session.activeTarget = null;
    source.updateMipmaps();
  }

  public copyDepth(source: DrawTarget, dest: Texture, session: RenderSession): void {
    const { target, viewport } = source;
    if (!target.depthStencilTexture) return;
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
   * Renders one View3D for the frame
   *
   * The BRDF lookup is shared by the renderer and made on its first environment use. A hemisphere
   * needs only the lookup, and each cube map source gets one prefiltered cube. Until a view has an
   * environment, its environment slots hold placeholders that sample as zero radiance.
   *
   * After the scene update has finalized bone matrices, the bone pit and the morph and geometry
   * stores are bound every frame, which picks up a texture that growth replaced. The shared atlas
   * and stores then upload their dirty ranges, and the view's draw caches rebuild if
   * `detectSharedCacheInvalidation` finds any shared buffer reallocated.
   * @param view3d - The view to render
   */
  public execute(view3d: View3D) {
    if (!view3d.isRenderable) return;

    view3d._ensureInitialized(this.renderer);

    const glData = getGlobalGlData(view3d, this.renderer);

    this._managedViews.track(view3d);

    const env = view3d.environment;

    if (env) {
      this._brdfLutTexture ||= generateBrdfLut({
        renderer: this.renderer,
        size: 512,
      });
      glData.globalBindGroup.setResource(this._brdfLutTexture.source, 2);

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
        glData.globalBindGroup.setResource(this._iblEnvironmentMap[sourceId].source, 1);
        glData.globalUniformGroup.uniforms.uEnvironmentMaxMipLevel =
          this._iblEnvironmentMap[sourceId].source.mipLevelCount - 1;
      }
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

    glData.globalBindGroup.setResource(view3d._bonePit.texture.source, 5);
    glData.globalBindGroup.setResource(this._morphStoreBuffer.texture.source, 8);
    glData.globalBindGroup.setResource(this.geometryDataStoreBuffer.texture.source, 9);

    this.atlasPool.update();
    this.materialStoreBuffer.update();
    this.geometryDataStoreBuffer.update();

    if (detectSharedCacheInvalidation(this.atlasPool, this.materialStoreBuffer, glData, this._morphStoreBuffer)) {
      view3d._invalidateDrawCaches();
    }

    glData.globalBindGroup.setResource(this.materialStoreBuffer.texture.source, 3);

    this.prepareView(renderSession);
    view3d._graph.run(renderSession);
  }

  /**
   * Frees the renderer-owned resources: the BRDF lookup, the prefiltered environment cubes and
   * the shared stores
   *
   * Each enrolled view's global bind group for this renderer goes first, before the textures it
   * binds. `atlasPool` outlives the renderer by design (`GeometryAtlasPool.from`).
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

    if (fog) {
      scratchFogColor.setValue(fog.color ?? DEFAULT_FOG_COLOR);
      writeLinearRgb(globalUniforms.uFogColor, 0, scratchFogColor, view3d.exposure);
      const fogParams = globalUniforms.uFogParams;
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
      /** The 3D scene pipe; types `renderer.renderPipes.view3d` on WebGL renderers */
      view3d: View3DPipeGl;
    }
  }
}
