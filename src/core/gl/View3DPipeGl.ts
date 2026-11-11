import { CLEAR, Color, CubeTexture, ExtensionType, Rectangle, State } from 'pixi.js';
import type { Geometry, InstructionPipe, InstructionSet, Shader, Texture, TextureSource, WebGLRenderer } from 'pixi.js';

import { GeometryAtlasPool } from '../../geometry/GeometryAtlasPool';
import { writeLinearRgb } from '../../materials/BaseMaterial3D';
import type { Vector3 } from '../../math/vector/Vector3';
import { updateView3DScene } from '../../scene/utils/updateView3DScene';
import type { ToneMapping, View3D } from '../../scene/View3D';
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
import { ColorOutputDraw } from '../render-passes/output/ColorOutputDraw';
import { cachesDrawWork } from '../render-passes/RenderForwardDescriptor';
import type { RenderForwardDescriptor } from '../render-passes/RenderForwardDescriptor';
import type { ReadonlyRect, RenderSession } from '../render-passes/RenderSession';
import {
  calculateDistancesFromStore,
  calculateDistancesFromWorldMatrix,
} from '../render-passes/transparent/transparentSortUtils';
import { CUBETEXTURE_EMPTY } from '../textures/DefaultTextures';
import { View3DGCRegistry } from '../View3DGCRegistry';
import type { View3DPipe } from '../View3DPipe';
import { renderForwardBatchesGl } from './renderForwardBatchesGl';
import { getGlobalGlData } from './shader/globalBitGl';
import { ShadowRenderPassGl } from './ShadowRenderPassGl';

/** Default `Fog.color`, which `Fog` in `View3D.ts` states */
const DEFAULT_FOG_COLOR = 0xcccccc;
const scratchFogColor = new Color();

/** @internal */
export class View3DPipeGl implements View3DPipe, InstructionPipe<View3D> {
  /** @ignore */
  public static extension = {
    type: [ExtensionType.WebGLPipes],
    name: 'view3d',
  } as const;

  public renderer: WebGLRenderer;

  private _brdfLutTexture?: Texture;

  private _destroyed = false;
  private _colorOutputDraw: ColorOutputDraw | null = null;

  private readonly _iblEnvironmentMap = new Map<TextureSource, CubeTexture>();

  /**
   * Unloads rather than destroys the cube: a view's bind group may hold it until the slot rebinds, and pixi warns
   * when a bound resource dies
   */
  private readonly _onEnvironmentDestroy = (source: TextureSource): void => {
    this._iblEnvironmentMap.get(source)?.source.unload();
    this._iblEnvironmentMap.delete(source);
  };

  private readonly _viewport = new Rectangle();

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

  /** Refilled per pass, then emptied so the pipe holds no frame's session or camera */
  private readonly _forwardOptions: Parameters<typeof renderForwardBatchesGl>[0] = {
    pipe: this,
    bit: 0,
    bindsMaterial: false,
    camera: null,
    session: null!,
    alwaysRebuild: true,
    sortBatch: undefined,
  };

  /** Made in `contextChange`, once the limits system has read `minUniformBufferOffsetAlignment` */
  public materialStoreBuffer!: MaterialDataStoreBuffer;

  public _morphStoreBuffer = new MorphStoreBuffer();

  public geometryDataStoreBuffer = new GeometryDataStoreBuffer();

  public readonly atlasPool = GeometryAtlasPool.from({ rebaseIndices: true });

  private readonly _managedViews: View3DGCRegistry;

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this._managedViews = new View3DGCRegistry(renderer);
    renderer.runners.contextChange.add(this);
  }

  /** Keeps an existing store across a context restore, since materials hold places in it */
  public contextChange(): void {
    this.materialStoreBuffer ??= new MaterialDataStoreBuffer({
      alignment: this.renderer.limits.minUniformBufferOffsetAlignment,
      rendererType: this.renderer.type,
    });
  }

  public createShadowPass(options: { shadowMapHandle: DepthHandle }): ShadowRenderPassGl {
    return new ShadowRenderPassGl({ renderer: this.renderer, shadowMapHandle: options.shadowMapHandle });
  }

  public prepareForward(_desc: RenderForwardDescriptor, _session: RenderSession): void {}

  public renderForward(desc: RenderForwardDescriptor, session: RenderSession): void {
    const options = this._forwardOptions;
    options.bit = desc.bit;
    options.bindsMaterial = desc.bindsMaterial;
    options.camera = desc.camera;
    options.session = session;
    options.alwaysRebuild = !cachesDrawWork(desc);
    options.sortBatch = desc.sort === 'distance' ? this._sortForwardByDistance : undefined;
    renderForwardBatchesGl(options);
    options.camera = null;
    options.session = null!;
  }

  public renderGeometry(geometry: Geometry, shader: Shader, state: State): void {
    this.renderer.encoder.draw({ geometry, shader, state });
  }

  /** Sets `gl.viewport` directly: pixi sets it only when a target binds, and rebinding would restart the pass */
  public setViewport(viewport: ReadonlyRect): void {
    this.renderer.gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
  }

  /**
   * Depth-writable state, applied through pixi's state system so its cache stays in step and 2D's
   * `depthMask: false` doesn't mask the clear
   */
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
    this.renderer.state.set(this._depthClearState);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(vp.x, vp.y, vp.width, vp.height);
    this.renderer.renderTarget.clear(this.renderer.renderTarget.renderTarget, CLEAR.DEPTH);
    gl.disable(gl.SCISSOR_TEST);
  }

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

  /** `finishRenderPass` resolves an antialiased `dest` before anything reads it or builds its mips */
  public outputColor(source: DrawTarget, dest: Texture, session: RenderSession, toneMapping: ToneMapping | null): void {
    const { target } = source;
    if (!target.colorTexture) return;
    const renderTargets = this.renderer.renderTarget;
    (this._colorOutputDraw ??= new ColorOutputDraw(this.renderer)).draw(this, source, dest, toneMapping);
    renderTargets.finishRenderPass();
    session.activeTarget = null;
  }

  /** Binds the view's own target first, so the texture isn't the bound colour attachment while its mips regenerate */
  public generateMips(handle: ColorHandle, session: RenderSession): void {
    const source = session.view3d._graph.getTexture(handle, session).source;
    this.renderer.renderTarget.bind({ target: session.defaultTarget, clear: CLEAR.NONE });
    session.activeTarget = null;
    source.updateMipmaps();
  }

  /** See `View3DPipe.resolveColor`: pixi's `finishRenderPass` is the blit, and it rebinds the target's framebuffer after */
  public resolveColor(): void {
    this.renderer.renderTarget.finishRenderPass();
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

  /** Rebinds the bone pit and the stores every frame, after the scene update, to pick up a texture that growth replaced */
  public execute(view3d: View3D) {
    if (!view3d.isRenderable) return;

    const glData = getGlobalGlData(view3d, this.renderer);

    const defaultTarget = this.renderer.renderTarget.renderTarget;

    view3d._ensureInitialized(this.renderer, glData, defaultTarget.colorTexture.source.resolution);

    this._managedViews.track(view3d);

    const env = view3d.environment;

    if (env) {
      this._brdfLutTexture ||= generateBrdfLut({ renderer: this.renderer });
      glData.globalBindGroup.setResource(this._brdfLutTexture.source, 'uBrdfLutTexture');
    }

    const environmentSource = this._prefilteredEnvironment(env);
    glData.globalBindGroup.setResource(environmentSource, 'uEnvironmentTexture');
    glData.globalUniformGroup.uniforms.uEnvironmentMaxMipLevel = environmentSource.mipLevelCount - 1;

    const lights = view3d.lights;
    if (view3d._meshSlots.count === 0 && view3d._meshBatches.length === 1) return;

    const renderSession: RenderSession = {
      view3d: view3d,
      lights,
      defaultTarget,
      defaultFrontFaceInverted: false,
      activeTarget: null,
      needsDepthClear: true,
      viewport: this._viewport,
      activeViewport: this._viewport,
      globalBindGroup: glData.globalBindGroup,
      globalUniformGroup: glData.globalUniformGroup,
      renderer: this.renderer,
    };

    if (!updateView3DScene(view3d, this, renderSession)) return;

    glData.globalBindGroup.setResource(view3d._bonePit.texture.source, 'uBonePitTexture');
    glData.globalBindGroup.setResource(this._morphStoreBuffer.texture.source, 'uMorphTexture');
    glData.globalBindGroup.setResource(this.geometryDataStoreBuffer.texture.source, 'uGeometryTexture');

    this.atlasPool.update();
    this.materialStoreBuffer.update();
    this.geometryDataStoreBuffer.update();

    if (detectSharedCacheInvalidation(this.atlasPool, this.materialStoreBuffer, glData, this._morphStoreBuffer)) {
      view3d._invalidateDrawCaches();
    }

    glData.globalBindGroup.setResource(this.materialStoreBuffer.texture.source, 'uMaterialStorage');

    this.prepareView(renderSession);
    view3d._graph.run(renderSession);
  }

  /**
   * Unloads every enrolled view first, so its global bind group goes before the textures it binds. `atlasPool` is
   * process-wide and outlives the renderer (`GeometryAtlasPool.from`).
   */
  public destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    this._managedViews.destroy();
    this._colorOutputDraw?.destroy();
    this._colorOutputDraw = null;

    this._brdfLutTexture?.destroy(true);
    this._brdfLutTexture = undefined;

    for (const [source, cube] of this._iblEnvironmentMap) {
      source.off('destroy', this._onEnvironmentDestroy);
      cube.destroy(true);
    }
    (this._iblEnvironmentMap as Map<TextureSource, CubeTexture> | null) = null;

    this.renderer.runners.contextChange.remove(this);
    this.materialStoreBuffer.destroy();
    (this.materialStoreBuffer as MaterialDataStoreBuffer | null) = null;
    this._morphStoreBuffer.destroy();
    this.geometryDataStoreBuffer.destroy();

    this._depthClearState = null;
  }

  private _prefilteredEnvironment(env: View3D['environment']): TextureSource {
    if (!(env instanceof CubeTexture) || env.source.destroyed) return CUBETEXTURE_EMPTY.source;

    let cube = this._iblEnvironmentMap.get(env.source);
    if (!cube) {
      cube = generateIblSpecialCubemap({ renderer: this.renderer, sourceTexture: env });
      this._iblEnvironmentMap.set(env.source, cube);
      env.source.once('destroy', this._onEnvironmentDestroy);
    }
    return cube.source;
  }

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
    globalUniforms.uDisplayExposure = Math.pow(view3d.exposure, 1 / 2.2);

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
