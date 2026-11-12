import type { RenderTarget, TextureSource } from 'pixi.js';

import { Matrix4 } from '../../../math/matrix/Matrix4';
import { Box } from '../../../math/shapes/Box';
import { Sphere } from '../../../math/shapes/Sphere';
import { Vector3 } from '../../../math/vector/Vector3';
import type { Light, ShadowData } from '../../../scene/lights/Light';
import type { SpotLight } from '../../../scene/lights/SpotLight';
import type { View3D } from '../../../scene/View3D';
import { warnOnce } from '../../../utils/warnOnce';
import { CameraData } from '../../CameraData';
import type { PassBuilder } from '../../render-graph/PassBuilder';
import type { DepthHandle } from '../../render-graph/ResourceHandle';
import { DEPTH_EMPTY } from '../../textures/DefaultTextures';
import type { View3DPipe } from '../../View3DPipe';
import { RenderPass } from '../RenderPass';
import type { RenderPassOptions } from '../RenderPass';
import type { RenderSession } from '../RenderSession';
import {
  computeCascadeMatrix,
  computeCascadeSplits,
  computeFixedBoxMatrix,
  prepareLightSpaceTransform,
} from './csmUtils';
import {
  MAX_SHADOW_SLOTS,
  SHADOW_QUALITY_SIZE,
  cascadeCountFor,
  cascadeRenderSkip,
  createShadowRenderTarget,
  updateRateFor,
  updateSpotShadowMatrices,
} from './shadowPassUtils';
import type { CascadeSlot, ShadowQuality } from './shadowPassUtils';

const tempEyeMatrix = new Matrix4();
const tempEye = new Vector3();

const _scratchSphere = new Sphere();
const _scratchBox = new Box();
const _scratchVec = new Vector3();

const DEFAULT_SHADOW_BIAS = 0.001;
/** Default `shadow.normalBias` of a spot light, which `LightShadow.normalBias` in `Light.ts` states */
const SPOT_SHADOW_NORMAL_BIAS = 0.15;
/**
 * Default `shadow.normalBias` of a directional light in shadow-map texels, which `LightShadow.normalBias`
 * in `Light.ts` states; the shadow bits taper it by `1 - N·L`, so this is the grazing-incidence offset
 */
const SHADOW_NORMAL_BIAS_TEXELS = 3;
/** Default `shadow.maxDistance`, which `LightShadow.maxDistance` in `Light.ts` states */
const DEFAULT_CASCADE_MAX_DISTANCE = 50;
/** World units per shadow-map texel above which the auto-fit box warns that shadows look soft */
const SHADOW_SOFT_TEXEL_THRESHOLD = 0.15;
/** Casters up to which the auto-fit box re-measures every frame, which `LightShadow.bounds` in `Light.ts` states */
const MAX_AUTO_FIT_CASTERS = 256;

/** The warnings built once, since their triggers hold frame after frame and the check must not allocate */
const WARN_BOUNDS_WITH_CASCADES =
  'Shadow: shadow.bounds and shadow.cascades are both set — cascades take precedence and the bounds ' +
  'box is ignored. Use bounds for a fixed region or cascades for a camera-following shadow, not both.';
const WARN_SHADOW_BOX_LARGE =
  'Shadow auto-fit box spans a large scene, so shadows may look soft. Raise view3d.shadowQuality, set ' +
  'light.shadow.bounds to the area that needs shadows, or, for a scene the camera roams across, enable ' +
  'cascades: light.shadow.cascades = 3.';
const WARN_SHADOW_BUDGET =
  `Too many shadow maps for the shadow budget of ${MAX_SHADOW_SLOTS}: each shadow-casting light takes one, ` +
  `or one per cascade. Lights past the budget render without shadows.`;

interface ShadowRenderPassBaseOptions extends RenderPassOptions {
  shadowMapHandle: DepthHandle;
}

/**
 * The shadow pass work both backends share; `ShadowRenderPassGpu` and `ShadowRenderPassGl` add the draws
 * @internal
 */
export abstract class ShadowRenderPassBase<
  P extends View3DPipe = View3DPipe,
  S extends ShadowData = ShadowData,
> extends RenderPass<P> {
  protected _renderTarget: RenderTarget | null = null;

  /** Layers the shadow map holds: the most slots claimed, never shrinking, since each growth re-records every bundle */
  private _layerCount = 0;

  protected _quality: ShadowQuality = 'medium';
  protected _frameCount = 0;
  private _hasCastersValue = false;
  private _hasCastersFrame = -1;
  private readonly _sceneCasterBounds = new Box();
  private _sceneBoundsFrame = -1;
  private _destroyed = false;

  /**
   * Bumped when the map's contents are discarded; each light's `ShadowData.targetVersion` records the
   * one its layers hold
   */
  public targetVersion = 0;

  /** Kept so `unload`, which runs outside a frame, can unbind the map it frees */
  private _view3d: View3D | null = null;

  /** The graph's handle on the shadow map, imported in `createDefaultGraph3D` */
  public readonly shadowMapHandle: DepthHandle;

  constructor(options: ShadowRenderPassBaseOptions) {
    super(options);
    this.shadowMapHandle = options.shadowMapHandle;
  }

  /** The shadow map's render target, created on first use */
  get renderTarget(): RenderTarget {
    if (this._renderTarget === null) {
      this._renderTarget = createShadowRenderTarget(this._quality, Math.max(this._layerCount, 1));
    }

    return this._renderTarget;
  }

  /**
   * Grows the shadow map to cover `slots` layers; called as slots are claimed, before the graph
   * runs, so the frame that needs more layers gets them
   */
  private _growAtlas(slots: number): void {
    if (slots <= this._layerCount) return;

    this._layerCount = Math.min(slots, MAX_SHADOW_SLOTS);
    this._releaseTarget();
  }

  /** The shadow quality tier; a change frees the map, and the next access makes one at the new size */
  set quality(value: ShadowQuality) {
    if (value === this._quality) return;
    this._quality = value;
    this._releaseTarget();
  }

  get quality(): ShadowQuality {
    return this._quality;
  }

  /**
   * Start-of-frame bookkeeping; the lighting system calls it every frame, even when the pass is
   * skipped, and nothing is bound yet, so a new `shadowQuality` can free the map here
   */
  public beginFrame(view3d: View3D): void {
    this._view3d = view3d;
    this.quality = view3d.shadowQuality;

    this._frameCount++;
    view3d._shadowDataList.reset();
  }

  /** Frees the shadow map; the next frame that needs shadows makes it again and every light re-renders */
  public unload(): void {
    this._releaseTarget();
  }

  /**
   * Unbinds the map before destroying it, so no bundle replays the freed view; pixi's
   * `RenderTarget.destroy` leaves a depth texture it was handed
   */
  private _releaseTarget(): void {
    const target = this._renderTarget;
    if (!target) return;

    this._renderTarget = null;
    this.targetVersion++;

    if (this._view3d) this._bindShadowSource(this._view3d, DEPTH_EMPTY.source);

    const shadowMap = target.depthStencilTexture!;
    target.destroy();
    shadowMap.destroy();
  }

  /**
   * Points the view's global shadow-map slot at `source`, re-recording every bundle in the view on a
   * change; it compares with the slot itself, since the view can re-create its global group
   */
  protected _bindShadowSource(view3d: View3D, source: TextureSource): void {
    const { group, slot } = view3d._graph.globalTextureBindings.shadowMap;
    if (group.getResource(slot) === source) return;

    group.setResource(source, slot);
    view3d._invalidateBundleCaches();
  }

  /** Declares the shadow map as a produce, so the graph binds no target and the pass binds its own layers */
  public override setup(b: PassBuilder): void {
    b.produce(this.shadowMapHandle);
  }

  /**
   * Skips the frame when no light can cast or no mesh is in the shadow pass; hidden casters count,
   * so the WebGPU pass still releases a hidden light's cull results for batches that left the view
   */
  public override condition(session: RenderSession): boolean {
    const lights = session.lights;

    for (let i = 0; i < lights.length; i++) {
      if (lights[i].canCastShadow) return this._hasCasters(session.view3d);
    }

    return false;
  }

  /** Whether any mesh is in the shadow pass this frame, hidden ones included; read once per frame */
  private _hasCasters(view3d: View3D): boolean {
    if (this._hasCastersFrame === this._frameCount) return this._hasCastersValue;
    this._hasCastersFrame = this._frameCount;

    const batches = view3d._meshBatches;
    let hasCasters = false;

    for (let i = 0; i < batches.length && !hasCasters; i++) {
      hasCasters = (batches[i].drawLists[this.bit]?.view.count ?? 0) > 0;
    }

    this._hasCastersValue = hasCasters;

    return hasCasters;
  }

  /** `true` remaps shadow depth to 0 to 1 for WebGPU; `false` keeps WebGL's -1 to 1 */
  protected abstract readonly _applyZRangeFix: boolean;

  /** The light's shadow data, created on first use */
  public getShadowGPUData(light: Light): S {
    return (light._gpuShadowData ??= {
      inverseLightMatrix: new Matrix4(),
      lightProjectionMatrix: new Matrix4(),
      /** Current from the start; a new light's first layers come from `_shadowRefreshRequested` */
      targetVersion: this.targetVersion,
    }) as S;
  }

  /**
   * The light's cascade slot, created on first use with a camera group of its own: WebGPU's
   * `writeBuffer` calls all land before the bundles run, so a shared group would draw every cascade alike
   */
  protected _cascadeSlot(light: Light, cascadeIndex: number): CascadeSlot {
    const cascades = (this.getShadowGPUData(light).cascades ??= []);

    return (cascades[cascadeIndex] ??= {
      cameraData: new CameraData(),
      bias: 0,
      normalBias: 0,
      mapSize: 0,
      cascadeCount: 0,
      splits: null,
      needsRender: true,
    });
  }

  /**
   * Writes a fitted cascade's matrices and cull volume into its camera data, so a cascade throttled
   * off later frames keeps a frustum that matches its frozen matrices
   */
  protected _commitCascadeCamera(slot: CascadeSlot, view: Matrix4, projection: Matrix4): void {
    tempEyeMatrix.getInverse(view);
    tempEyeMatrix.extractPosition(tempEye);

    const cameraData = slot.cameraData;

    cameraData.set(tempEye, view, projection);
    cameraData.frustum.setFromProjectionMatrix(cameraData.viewProjection);
  }

  /**
   * Fits a light's shadow and fills its cascade slots for `uShadowData`; a cascade its update rate
   * skips keeps its matrices, and re-renders only when the map was discarded since
   */
  public updateLightShadowData(light: Light, view3d: View3D): void {
    if (!light.canCastShadow) return;

    const camera = view3d.camera;
    const shadowData = this.getShadowGPUData(light);
    const { inverseLightMatrix, lightProjectionMatrix } = shadowData;
    const targetStale = shadowData.targetVersion !== this.targetVersion;
    const mapSize = SHADOW_QUALITY_SIZE[this._quality];
    const forceUpdate = light._shadowRefreshRequested;
    const update = light.shadow.update;
    const bias = light.shadow.bias ?? DEFAULT_SHADOW_BIAS;

    if (light.type === 'spot' || light.shadow.cascades === undefined) {
      const slot = this._cascadeSlot(light, 0);
      const renderSkip = cascadeRenderSkip(updateRateFor(update, 0), this._frameCount, forceUpdate);

      if (!renderSkip) {
        if (light.type === 'spot') {
          updateSpotShadowMatrices(light as SpotLight, inverseLightMatrix, lightProjectionMatrix, this._applyZRangeFix);
          this._commitCascadeCamera(slot, inverseLightMatrix, lightProjectionMatrix);
          slot.normalBias = light.shadow.normalBias ?? SPOT_SHADOW_NORMAL_BIAS;
        } else {
          const bounds = light.shadow.bounds ?? this._resolveAutoShadowBounds(light, view3d, mapSize);
          if (bounds !== undefined && !bounds.isEmpty()) {
            inverseLightMatrix.getInverse(light.worldTransform);
            computeFixedBoxMatrix(bounds, inverseLightMatrix, lightProjectionMatrix, mapSize, this._applyZRangeFix);
            this._commitCascadeCamera(slot, inverseLightMatrix, lightProjectionMatrix);
            slot.normalBias = this._resolveNormalBias(light, lightProjectionMatrix, mapSize);
          }
        }
      }

      slot.bias = bias;
      slot.mapSize = mapSize;
      slot.cascadeCount = 0;
      slot.splits = null;
      slot.needsRender = targetStale || !renderSkip;
      return;
    }

    if (light.shadow.bounds !== undefined) warnOnce('pixijs-3d-shadow-bounds-cascades', WARN_BOUNDS_WITH_CASCADES);
    inverseLightMatrix.getInverse(light.worldTransform);

    const cascadeCount = cascadeCountFor(light);
    const lambda = light.shadow.lambda;

    const maxDist = Math.min(light.shadow.maxDistance ?? DEFAULT_CASCADE_MAX_DISTANCE, camera.far);

    const cascade0 = this._cascadeSlot(light, 0);
    const splits = (cascade0.splits ??= []);
    computeCascadeSplits(camera.near, maxDist, cascadeCount, lambda, splits);

    prepareLightSpaceTransform(camera, inverseLightMatrix);

    for (let c = 0; c < cascadeCount; c++) {
      const slot = c === 0 ? cascade0 : this._cascadeSlot(light, c);
      const renderSkip = cascadeRenderSkip(updateRateFor(update, c), this._frameCount, forceUpdate);

      if (!renderSkip) {
        const splitNear = c === 0 ? camera.near : splits[c - 1];
        computeCascadeMatrix(camera, splitNear, splits[c], lightProjectionMatrix, mapSize, this._applyZRangeFix);
        this._commitCascadeCamera(slot, inverseLightMatrix, lightProjectionMatrix);
        slot.normalBias = this._resolveNormalBias(light, lightProjectionMatrix, mapSize);
      }

      slot.bias = bias;
      slot.mapSize = mapSize;
      slot.cascadeCount = c === 0 && cascadeCount > 1 ? cascadeCount : 0;
      if (c > 0) slot.splits = null;
      slot.needsRender = targetStale || !renderSkip;
    }
  }

  /**
   * Marks a light's layers current; the backends call it once the draws ran, so a refresh is marked
   * done only on a frame that drew the light
   */
  protected _completeShadowUpdate(light: Light): void {
    if (light._gpuShadowData) light._gpuShadowData.targetVersion = this.targetVersion;
    light._shadowRefreshRequested = false;
  }

  /** The auto-fit box of a directional light with no `shadow.bounds`, or `undefined` before any caster */
  private _resolveAutoShadowBounds(light: Light, view3d: View3D, mapSize: number): Box | undefined {
    const casterCount = this._countSceneCasters(view3d);
    const prev = light._autoShadowBounds;

    if (casterCount > MAX_AUTO_FIT_CASTERS && light._autoShadowBoundsFrozen) return prev ?? undefined;

    const gathered = this._ensureSceneCasterBounds(view3d);
    if (gathered.isEmpty()) return prev ?? undefined;

    const box = prev ?? (light._autoShadowBounds = new Box());
    box.copyFrom(gathered);

    if (casterCount <= MAX_AUTO_FIT_CASTERS) {
      light._autoShadowBoundsFrozen = false;
    } else {
      light._autoShadowBoundsFrozen = true;
      warnOnce(
        'pixijs-3d-shadow-autofit-cap',
        `Shadow auto-fit: ${casterCount} shadow casters is over the auto-measure cap (${MAX_AUTO_FIT_CASTERS}), ` +
          `so the shadow box was fitted once and frozen. If casters move or spawn outside it, set shadow.bounds, ` +
          `enable shadow.cascades, or call light.fitShadowBounds() after changes.`,
      );
    }

    this._warnIfShadowBoxLarge(box, mapSize);
    return box;
  }

  private _countSceneCasters(view3d: View3D): number {
    let count = 0;
    const batches = view3d._meshBatches;

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      if (!batch.renderData._worldVisible) continue;
      const pd = batch.drawLists[this.bit];
      if (pd) count += pd.view.count;
    }

    return count;
  }

  /**
   * World-space box around every visible shadow caster, gathered once per frame; the scene batch,
   * always first, holds world-space spheres, and a {@link BatchedMesh3D}'s are batch-local
   */
  private _ensureSceneCasterBounds(view3d: View3D): Box {
    if (this._sceneBoundsFrame === this._frameCount) return this._sceneCasterBounds;
    this._sceneBoundsFrame = this._frameCount;

    const box = this._sceneCasterBounds.makeEmpty();
    const batches = view3d._meshBatches;

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      if (!batch.renderData._worldVisible) continue;
      const list = batch.drawLists[this.bit];
      if (!list || list.view.count === 0) continue;

      const batchMatrix = b === 0 ? null : batch.renderData.worldTransform;
      const items = list.view.items;
      const renderableIndices = list.view.renderableIndices;

      for (let i = 0; i < list.view.count; i++) {
        const item = items[renderableIndices[i]];
        if (item._worldVisible === 0) continue;
        const sphere = item.boundingSphere;
        if (sphere.radius < 0) continue;

        const world = batchMatrix ? sphere.applyMatrix4(batchMatrix, _scratchSphere) : sphere;
        box.union(world.getBounds(_scratchBox));
      }
    }

    return box;
  }

  private _warnIfShadowBoxLarge(bounds: Box, mapSize: number): void {
    if (bounds.isEmpty()) return;

    const size = bounds.getSize(_scratchVec);
    if (Math.max(size.x, size.y, size.z) / mapSize > SHADOW_SOFT_TEXEL_THRESHOLD) {
      warnOnce('pixijs-3d-shadow-autofit-large', WARN_SHADOW_BOX_LARGE);
    }
  }

  /** The light's `shadow.normalBias`, else {@link SHADOW_NORMAL_BIAS_TEXELS} at the projection's texel size */
  private _resolveNormalBias(light: Light, orthoProjection: Matrix4, mapSize: number): number {
    if (light.shadow.normalBias !== undefined) return light.shadow.normalBias;
    const texelWorld = 2 / (orthoProjection.elements[0] * mapSize);
    return SHADOW_NORMAL_BIAS_TEXELS * texelWorld;
  }

  /**
   * Claims a light's shadow slots, fits it, and adds its slots to the view's shadow list; the
   * lighting systems' one entry point, so they never track shadow state
   */
  public prepareShadow(light: Light, view3d: View3D): void {
    const list = view3d._shadowDataList;
    const slots = this._claimShadowSlots(light, view3d, list.count);
    if (slots === 0) return;

    this._growAtlas(list.count + slots);
    this.updateLightShadowData(light, view3d);

    const cascades = this.getShadowGPUData(light).cascades!;
    for (let c = 0; c < slots; c++) list.add(cascades[c]);
  }

  /**
   * Claims this frame's slots for a light and sets its `_shadowDataIndex`, or sets -1 and returns 0
   * when it can't cast, nothing casts, or the budget is full
   */
  private _claimShadowSlots(light: Light, view3d: View3D, claimed: number): number {
    const castsShadow = light.canCastShadow && this._hasCasters(view3d);
    const cascadeCount = cascadeCountFor(light);

    if (castsShadow && claimed + cascadeCount <= MAX_SHADOW_SLOTS) {
      light._shadowDataIndex = claimed;
      return cascadeCount;
    }

    if (castsShadow) warnOnce('pixijs-3d-shadow-budget', WARN_SHADOW_BUDGET);

    light._shadowDataIndex = -1;
    return 0;
  }

  /**
   * Releases the shadow map without unbinding it, since the view tears its global bind group down
   * before it destroys the graph
   */
  public override destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this._view3d = null;
    this._releaseTarget();

    super.destroy();
  }
}
