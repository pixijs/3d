import { Color, CubeTexture, ExtensionType, Rectangle, Shader, State } from 'pixi.js';
import type {
  Geometry,
  GPU,
  InstructionPipe,
  InstructionSet,
  Texture,
  TextureSource,
  WebGLRenderer,
  WebGPURenderer,
} from 'pixi.js';

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
import { fullscreenTriangleGeometry } from '../fullscreenTriangleGeometry';
import { generateBrdfLut } from '../ibl/generateBrdfLut';
import { generateIblSpecialCubemap } from '../ibl/generateIblSpecialCubemap';
import type { DrawTarget } from '../render-graph/RenderGraph';
import type { ColorHandle, DepthHandle } from '../render-graph/ResourceHandle';
import { ColorOutputDraw } from '../render-passes/output/ColorOutputDraw';
import { cachesDrawWork } from '../render-passes/RenderForwardDescriptor';
import type { RenderForwardDescriptor } from '../render-passes/RenderForwardDescriptor';
import type { ReadonlyRect, RenderSession } from '../render-passes/RenderSession';
import { calculateTransparentDistances } from '../render-passes/transparent/transparentSortUtils';
import { CUBETEXTURE_EMPTY } from '../textures/DefaultTextures';
import { View3DGCRegistry } from '../View3DGCRegistry';
import type { View3DPipe } from '../View3DPipe';
import { computeForwardBatchesGpu, prepareForwardBatchesGpu, renderForwardBatchesGpu } from './renderForwardBatchesGpu';
import { getGlobalGpuData } from './shader/globalBitGpu';
import { ShadowRenderPassGpu } from './ShadowRenderPassGpu';

/** Default `Fog.color`, which `Fog.color` in `View3D.ts` states */
const DEFAULT_FOG_COLOR = 0xcccccc;
const scratchFogColor = new Color();
/** Refilled per copy, since pixi clamps the rect in place */
const scratchCopyRegion = new Rectangle();
const scratchCopyDest = { x: 0, y: 0 };

type ForwardOptionsGpu = Parameters<typeof renderForwardBatchesGpu>[0];

/** @internal */
export class View3DPipeGpu implements View3DPipe, InstructionPipe<View3D> {
  /** @ignore */
  public static extension = {
    type: [ExtensionType.WebGPUPipes],
    name: 'view3d',
  } as const;

  public renderer: WebGPURenderer;

  private _brdfLutTexture?: Texture;

  private readonly _iblEnvironmentMap = new Map<TextureSource, CubeTexture>();

  /**
   * Unloads rather than destroys the cube, since a view's bind group may hold it until its next frame,
   * and pixi warns when a resource dies under a bind group
   */
  private readonly _onEnvironmentDestroy = (source: TextureSource): void => {
    this._iblEnvironmentMap.get(source)?.source.unload();
    this._iblEnvironmentMap.delete(source);
  };

  /** `RenderSession.viewport` for every view, since views render one at a time */
  private readonly _viewport = new Rectangle();

  /** Bound once, so a frame allocates no closure */
  private readonly _sortForwardByDistance = (
    renderables: SortedMesh3DView<Mesh3DData>,
    batch: Mesh3DBatch,
    cameraPosition: Vector3,
  ): void => {
    calculateTransparentDistances(renderables, batch.storeBuffer.data, cameraPosition);
  };

  /** Refilled per call so a pass allocates none, and cleared after so the pipe holds no frame's objects */
  private readonly _forwardOptions: ForwardOptionsGpu = {
    pipe: this,
    bit: 0,
    bindsMaterial: false,
    cullResults: null!,
    camera: null,
    session: null!,
    useBundles: false,
    sortBatch: undefined,
  };

  /** Made in `contextChange`, since its alignment comes from device limits that don't exist yet here */
  public materialStoreBuffer!: MaterialDataStoreBuffer;

  public _morphStoreBuffer = new MorphStoreBuffer();

  public geometryDataStoreBuffer = new GeometryDataStoreBuffer();

  public readonly atlasPool = GeometryAtlasPool.from({ rebaseIndices: false });

  private readonly _managedViews: View3DGCRegistry;

  private _destroyed = false;
  private _colorOutputDraw: ColorOutputDraw | null = null;

  /** Joins the `contextChange` runner itself, since pixi joins only systems to it */
  constructor(renderer: WebGLRenderer | WebGPURenderer) {
    this.renderer = renderer as WebGPURenderer;
    this._managedViews = new View3DGCRegistry(this.renderer);
    this.renderer.runners.contextChange.add(this);
  }

  /**
   * Runs after the limits system, which joined the runner first, and keeps the store across a device
   * restore, since materials hold places in it
   */
  public contextChange(gpu: GPU): void {
    if (!gpu.device.features.has('indirect-first-instance')) {
      throw new Error(
        "@pixi/3d requires the WebGPU 'indirect-first-instance' feature (used by the batched indirect draw path).",
      );
    }

    this.materialStoreBuffer ??= new MaterialDataStoreBuffer({
      alignment: this.renderer.limits.minUniformBufferOffsetAlignment,
      rendererType: this.renderer.type,
    });
  }

  public createShadowPass(options: { shadowMapHandle: DepthHandle }): ShadowRenderPassGpu {
    return new ShadowRenderPassGpu({ renderer: this.renderer, shadowMapHandle: options.shadowMapHandle });
  }

  public renderForward(desc: RenderForwardDescriptor, session: RenderSession): void {
    renderForwardBatchesGpu(this._fillForwardOptions(desc, session, desc.sort === 'distance'));
    this._releaseForwardOptions();
  }

  public prepareForward(desc: RenderForwardDescriptor, session: RenderSession): void {
    if (!cachesDrawWork(desc)) return;

    const options = this._fillForwardOptions(desc, session, false);
    prepareForwardBatchesGpu(options);
    computeForwardBatchesGpu(options);
    this._releaseForwardOptions();
  }

  private _fillForwardOptions(
    desc: RenderForwardDescriptor,
    session: RenderSession,
    sortByDistance: boolean,
  ): ForwardOptionsGpu {
    const options = this._forwardOptions;
    options.useBundles = cachesDrawWork(desc);
    options.bit = desc.bit;
    options.bindsMaterial = desc.bindsMaterial;
    options.cullResults = desc.cullResults;
    options.camera = desc.camera;
    options.session = session;
    options.sortBatch = sortByDistance ? this._sortForwardByDistance : undefined;
    return options;
  }

  private _releaseForwardOptions(): void {
    this._forwardOptions.cullResults = null!;
    this._forwardOptions.camera = null;
    this._forwardOptions.session = null!;
  }

  public renderGeometry(geometry: Geometry, shader: Shader, state: State): void {
    this.renderer.encoder.draw({ geometry, shader, state });
  }

  /** Casts, since pixi's encoder reads only the rect's four numbers */
  public setViewport(viewport: ReadonlyRect): void {
    this.renderer.encoder.setViewport(viewport as Rectangle);
  }

  private _depthClearShader: Shader | null = null;
  private _depthClearState: State | null = null;

  /** Draws at the far plane with colour masked off, clipped by the viewport the executor already set */
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

  /** `depthTest: false` is pixi's compare `'always'`, so with `depthMask` every pixel takes the far plane */
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

  /** Closes the open pass, since WebGPU can't copy inside one, and nulls `activeTarget` for the executor to reopen */
  public copyColor(source: DrawTarget, dest: Texture, session: RenderSession): void {
    const { target, viewport } = source;
    if (!target.colorTexture) return;
    this.renderer.renderTarget.finishRenderPass();
    const frame = dest.frame;
    const resolution = dest.source.resolution;
    scratchCopyDest.x = Math.round(frame.x * resolution);
    scratchCopyDest.y = Math.round(frame.y * resolution);
    this.renderer.renderTarget.copyToTexture(
      target,
      dest,
      scratchCopyRegion.copyFrom(viewport),
      scratchCopyRegion,
      scratchCopyDest,
    );
    session.activeTarget = null;
  }

  /** Closes the open pass, as `copyColor` does */
  public outputColor(source: DrawTarget, dest: Texture, session: RenderSession, toneMapping: ToneMapping | null): void {
    if (!source.target.colorTexture) return;
    this.renderer.renderTarget.finishRenderPass();
    (this._colorOutputDraw ??= new ColorOutputDraw(this.renderer)).draw(this, source, dest, toneMapping);
    session.activeTarget = null;
  }

  /** Closes the pass an effect may have left open, as `MipChainSystemGpu` begins passes of its own */
  public generateMips(handle: ColorHandle, session: RenderSession): void {
    const source = session.view3d._graph.getTexture(handle, session).source;
    this.renderer.renderTarget.finishRenderPass();
    session.activeTarget = null;
    this.renderer.mipChain3d.generate(source);
  }

  /** WebGPU resolves into the texture when the render pass ends */
  public resolveColor(): void {}

  /** Closes the open pass, as `copyColor` does */
  public copyDepth(source: DrawTarget, dest: Texture, session: RenderSession): void {
    const { target, viewport } = source;
    if (!target.depthStencilTexture) return;
    this.renderer.renderTarget.finishRenderPass();
    scratchCopyDest.x = 0;
    scratchCopyDest.y = 0;
    this.renderer.renderTarget.copyDepthTexture(
      target,
      dest,
      scratchCopyRegion.copyFrom(viewport),
      scratchCopyRegion,
      scratchCopyDest,
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
   * Re-records the bundles when the environment cube changes, and re-binds the stores every frame, after
   * the scene update may have grown them. A view with no meshes draws nothing, background included.
   */
  public execute(view3d: View3D) {
    if (!view3d.isRenderable) return;

    const gpuData = getGlobalGpuData(view3d, this.renderer);

    const defaultTarget = this.renderer.renderTarget.renderTarget;

    view3d._ensureInitialized(this.renderer, gpuData, defaultTarget.colorTexture.source.resolution);

    this._managedViews.track(view3d);

    const env = view3d.environment;

    if (env) {
      this._brdfLutTexture ||= generateBrdfLut({ renderer: this.renderer });
      gpuData.globalBindGroup.setResource(this._brdfLutTexture.source, 'uBrdfLutTexture');
    }

    const environmentSource = this._prefilteredEnvironment(env);
    if (gpuData.globalBindGroup.getResource('uEnvironmentTexture') !== environmentSource) {
      gpuData.globalBindGroup.setResource(environmentSource, 'uEnvironmentTexture');
      view3d._invalidateBundleCaches();
    }

    const lights = view3d.lights;
    if (view3d._meshSlots.count === 0 && view3d._meshBatches.length === 1) return;

    const renderSession: RenderSession = {
      view3d,
      lights,
      defaultTarget,
      defaultFrontFaceInverted: false,
      activeTarget: null,
      needsDepthClear: true,
      viewport: this._viewport,
      activeViewport: this._viewport,
      globalBindGroup: gpuData.globalBindGroup,
      renderer: this.renderer,
    };

    if (!updateView3DScene(view3d, this, renderSession)) return;

    gpuData.globalBindGroup.setResource(this.materialStoreBuffer.texture.source, 'uMaterialStorage');
    gpuData.globalBindGroup.setResource(view3d._bonePit.bufferResource, 'uBonePitStorage');
    gpuData.globalBindGroup.setResource(this._morphStoreBuffer.bufferResource, 'uMorphStorage');
    gpuData.globalBindGroup.setResource(this.geometryDataStoreBuffer.bufferResource, 'uGeometryStorage');
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
   * Unloads the views first, so their bind groups go before what they bind; `atlasPool` outlives the
   * renderer, as `GeometryAtlasPool.from` says
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

    this._depthClearShader?.destroy();
    this._depthClearShader = null;
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

  /**
   * Uploads the static group itself, since bundles replay without pixi's per-draw sync, and rewrites the
   * fog colour every frame, since it carries `exposure`, which can change alone
   */
  private _updateGlobalUniforms(view3d: View3D): void {
    const { fog } = view3d;

    const gpuData = getGlobalGpuData(view3d, this.renderer);
    const globalUniformGroup = gpuData.globalUniformGroup;
    const globalUniforms = globalUniformGroup.uniforms;

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

    globalUniformGroup.update();
    this.renderer.ubo.updateUniformGroup(globalUniformGroup);
  }
}

declare global {
  namespace PixiMixins {
    interface WebGPUPipes {
      /** The 3D scene pipe; types `renderer.renderPipes.view3d` on WebGPU renderers */
      view3d: View3DPipeGpu;
    }
  }
}
