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
  MAX_CASCADES,
  computeCascadeMatrix,
  computeCascadeSplits,
  computeFixedBoxMatrix,
  prepareLightSpaceTransform,
} from './csmUtils';
import {
  MAX_SHADOW_LIGHTS,
  MAX_SHADOW_SLOTS,
  SHADOW_QUALITY_SIZE,
  cascadeCountFor,
  cascadeRenderSkip,
  createShadowRenderTarget,
  updateRateFor,
  updateSpotShadowMatrices,
} from './shadowPassUtils';
import type { CascadeSlot, ShadowQuality } from './shadowPassUtils';

// Reused scratch for `_commitCascadeCamera` — the cascade's eye, inverted out of its view.
const tempEyeMatrix = new Matrix4();
const tempEye = new Vector3();

// Reused scratch for the auto-fit scene-bounds gather.
const _scratchSphere = new Sphere();
const _scratchBox = new Box();
const _scratchVec = new Vector3();

const DEFAULT_SHADOW_BIAS = 0.001;
/**
 * Normal-offset fallback for spot lights at grazing incidence — a perspective map has no
 * single texel size to derive one from
 */
const SPOT_SHADOW_NORMAL_BIAS = 0.15;
/**
 * Normal-offset bias in shadow-map texels, at grazing incidence
 *
 * The world-space offset scales with each texel's world size, and the shader tapers it by
 * `1 - N·L` — so this is the offset a surface the light barely grazes receives, and a surface
 * facing the light receives almost none. Sized so the grazing case stays acne-free; the taper
 * is what keeps the offset off short shadows everywhere else.
 */
const SHADOW_NORMAL_BIAS_TEXELS = 3;
/** Fallback cascade reach (world units) when a cascaded light sets no `maxDistance` */
const DEFAULT_CASCADE_MAX_DISTANCE = 50;
/** World-units-per-texel above which the auto-fit box is deemed "soft" and cascades are suggested */
const SHADOW_SOFT_TEXEL_THRESHOLD = 0.15;
/**
 * Caster-count cap under which the auto-fit box re-measures every frame
 *
 * Sized for low-end mobile: a cap-sized walk is a few tens of microseconds worst case.
 * Above it the box is fitted once and frozen — a per-frame walk over e.g. a
 * 50k-instance batch is a hidden cost the user never asked for — and a one-time warn
 * points at the explicit placement tools.
 */
const MAX_AUTO_FIT_CASTERS = 256;

// Messages for warns whose trigger state persists frame over frame — hoisted so the hot
// paths stay allocation-free; `warnOnce` dedups the console side.
const WARN_BOUNDS_WITH_CASCADES =
  'Shadow: shadow.bounds and shadow.cascades are both set — cascades take precedence and the bounds ' +
  'box is ignored. Use bounds for a fixed region or cascades for a camera-following shadow, not both.';
const WARN_SHADOW_BOX_LARGE =
  'Shadow auto-fit box spans a large scene, so shadows may look soft. For a roaming or large ' +
  'scene, enable cascades: light.shadow.cascades = 3.';
const WARN_SHADOW_BUDGET =
  `Too many shadow-casting lights for the shadow budget (${MAX_SHADOW_LIGHTS} lights × ` +
  `${MAX_CASCADES} cascades = ${MAX_SHADOW_SLOTS} slots). Extra casters render without shadows.`;

/**
 * Base render-pass options plus the graph-imported shadow-map array handle
 * @internal
 */
interface ShadowRenderPassBaseOptions extends RenderPassOptions {
  /** Graph-imported tracking handle for the shadow-map array texture */
  shadowMapHandle: DepthHandle;
}

/**
 * Backend-shared scaffolding for the cascaded shadow passes
 *
 * Owns the lazily (re)created shadow-map array target, the quality tier, the temporal
 * frame counter, and the graph wiring (`setup` / `condition`). The WebGPU and WebGL
 * passes subclass this and supply only the backend-specific resource creation,
 * matrix upload, and render loop.
 * @internal
 */
export abstract class ShadowRenderPassBase<
  P extends View3DPipe = View3DPipe,
  S extends ShadowData = ShadowData,
> extends RenderPass<P> {
  /** Lazily (re)created depth array texture target spanning the claimed shadow layers */
  protected _renderTarget: RenderTarget | null = null;

  /**
   * Layers the array texture is sized for — the high-water mark of slots claimed
   *
   * The atlas spans every (light, cascade) slot as one array texture, so it costs
   * `layers × mapSize² × 4` bytes: 4 MB per layer at the default quality, 16 MB at `'high'`.
   * Sizing it to the whole budget up front spends 64 MB on a scene whose single sun uses
   * three layers, so it grows to fit instead.
   *
   * Grows only. Each growth costs a reallocation plus every render bundle that samples the
   * map; shrinking would hand that cost to anything that toggles `castShadow`, to give back
   * memory the scene has already shown it can ask for.
   */
  private _layerCount = 0;

  /** Current shadow map resolution tier; changing it rebuilds the target */
  protected _quality: ShadowQuality = 'medium';

  /** Frame counter driving the every-Nth-frame `update` cadence */
  protected _frameCount = 0;

  /** Shadow-atlas slots claimed so far this frame; reset by {@link ShadowRenderPassBase.beginFrame} */
  protected _shadowCount = 0;

  /** World-space caster AABB for the auto-fit box, recomputed once per frame */
  private readonly _sceneCasterBounds = new Box();

  /** `_frameCount` the caster bounds were last gathered for */
  private _sceneBoundsFrame = -1;

  /** Re-entry guard for {@link ShadowRenderPassBase.destroy}; shared with subclasses */
  protected _destroyed = false;

  /**
   * Bumped every time the map's contents are discarded
   *
   * Each light records the version its layers were rendered into
   * (`ShadowData.targetVersion`), so a light whose layers were thrown away re-renders them
   * instead of trusting a map that no longer holds its depth.
   */
  public targetVersion = 0;

  /**
   * The view this pass belongs to (one graph per view), captured at the first frame boundary
   *
   * `unload` runs outside a frame and still has to unbind the map it frees.
   */
  private _view3d: View3D | null = null;

  /**
   * Graph-imported tracking handle for the shadow-map array texture
   *
   * The pass owns the underlying `TextureSource` (lazy-allocated via
   * {@link ShadowRenderPassBase#renderTarget}, reallocated on quality changes); the handle is
   * registered in `createDefaultGraph3D` via
   * `graph.importDepth(() => pass.renderTarget.depthStencilTexture)`.
   */
  public readonly shadowMapHandle: DepthHandle;

  constructor(options: ShadowRenderPassBaseOptions) {
    super(options);
    this.shadowMapHandle = options.shadowMapHandle;
  }

  /**
   * The shared render target for all shadow layers
   *
   * Created on first access. The backends install the map in the view's global group through
   * {@link ShadowRenderPassBase#_bindShadowSource}, which is also what re-records every bundle
   * that baked a previous map.
   */
  get renderTarget(): RenderTarget {
    if (this._renderTarget === null) {
      this._renderTarget = createShadowRenderTarget(this._quality, Math.max(this._layerCount, 1));
    }

    return this._renderTarget;
  }

  /**
   * Grows the shadow-map array to cover `slots` layers
   *
   * Dropping the target leaves {@link ShadowRenderPassBase#renderTarget} to mint a bigger one.
   * Released through {@link ShadowRenderPassBase#_releaseTarget} so the global binding and every
   * recorded bundle let go of the old atlas before it dies, and `targetVersion` moves so every
   * light re-renders its layers into the blank, bigger map.
   *
   * Called as slots are claimed, before the graph runs, so the frame that needs a bigger atlas
   * is the frame that gets one — the pass's own render re-creates and re-binds the map later the
   * same frame.
   * @param slots - Layer count the atlas must cover
   */
  private _growAtlas(slots: number): void {
    if (slots <= this._layerCount) return;

    this._layerCount = Math.min(slots, MAX_SHADOW_SLOTS);
    this._releaseTarget();
  }

  /**
   * Sets the shadow quality tier
   *
   * Changing the tier releases the current map through
   * {@link ShadowRenderPassBase#_releaseTarget} — the global binding moves to the placeholder
   * and every recorded bundle is invalidated before the target dies — and the next
   * {@link ShadowRenderPassBase#renderTarget} access mints one at the new size.
   * @param value - The new quality tier
   */
  set quality(value: ShadowQuality) {
    if (value === this._quality) return;
    this._quality = value;
    this._releaseTarget();
  }

  /** The current shadow map resolution tier */
  get quality(): ShadowQuality {
    return this._quality;
  }

  /** Shadow slots claimed this frame; read by the lighting system after its light loop */
  get shadowCount(): number {
    return this._shadowCount;
  }

  /**
   * Start-of-frame shadow bookkeeping
   *
   * Called once per frame by the lighting system before its light loop, which runs
   * every frame regardless of whether the pass is culled. Advances the temporal counter
   * that drives the every-Nth-frame `shadow.update` cadence (so it tracks real frames
   * even across culled frames) and resets the per-frame slot cursor.
   *
   * Also where the view's `shadowQuality` is applied: at the frame boundary nothing is
   * bound and no bundle has been recorded yet this frame, so a changed tier can release
   * the map without stranding a live reference.
   * @param view3d - The view being rendered this frame
   */
  public beginFrame(view3d: View3D): void {
    this._view3d = view3d;
    this.quality = view3d.shadowQuality;

    this._frameCount++;
    this._shadowCount = 0;
  }

  /**
   * Frees the shadow map now — the largest allocation this pass owns (64 MB at the default tier)
   *
   * Idempotent, and recoverable by construction: the next frame that needs shadows re-creates the
   * map and every light re-renders its layers into it.
   */
  public unload(): void {
    this._releaseTarget();
  }

  /**
   * Discards the shadow map
   *
   * The order is load-bearing: the global binding moves to the empty depth texture and every
   * recorded bundle is invalidated *before* the old target dies, so nothing can replay a bundle
   * that baked the freed texture view.
   */
  private _releaseTarget(): void {
    const target = this._renderTarget;
    if (!target) return;

    this._renderTarget = null;
    this.targetVersion++;

    if (this._view3d) this._bindShadowSource(this._view3d, DEPTH_EMPTY.source);

    target.destroy();
  }

  /**
   * Points the view's global shadow-map slot at `source`
   *
   * A change of identity has to re-record every bundle in the view: a WebGPU bundle bakes the
   * native bind group, so one recorded against the previous map would keep sampling it — or,
   * after a release, a freed handle. The slot itself says what is bound, so the check reads it
   * rather than a copy that could drift when the view re-creates its global group. Nothing to
   * re-point when this renderer has no global data on the view yet (before its first frame,
   * or after the data was collected).
   * @param view3d - The view whose global bind group holds the shadow-map slot
   * @param source - The depth texture to bind
   */
  protected _bindShadowSource(view3d: View3D, source: TextureSource): void {
    const data = view3d._gpuData[this.pipe.renderer.uid];
    if (!data) return;

    const { globalBindGroup } = data;
    const slot = this.pipe.globalSlots.shadowMap;
    if (globalBindGroup.getResource(slot) === source) return;

    globalBindGroup.setResource(source, slot);
    view3d._invalidateBundleCaches();
  }

  /**
   * Declares the shadow-map array texture as a producer output
   *
   * The graph treats the cascade loop as one logical "produce" — the pass manages its
   * own per-layer target binds internally, so the executor performs no target push and
   * `render()` runs free of an active target.
   * @param b - The builder recording this pass's resource accesses
   */
  public override setup(b: PassBuilder): void {
    b.produce(this.shadowMapHandle);
  }

  /**
   * Culls the pass when there's nothing to do: no shadow-casting light is in the scene,
   * or no mesh participates in the SHADOW bit
   *
   * Membership, not visibility: the pass stays active while casters *exist*, so the
   * shadow-map binding (baked into forward bundles) never appears or disappears with a
   * visibility flip — an all-hidden frame just renders a validly empty map. Lifting both
   * gates here lets refcount cull drop the pass entirely (no per-light loop entered).
   * A culled pass keeps each batch's recorded list: nothing about the casters changed, so
   * the next active frame replays it as is.
   * @param session - The current frame's render session
   * @returns Whether the pass should run this frame
   */
  public override condition(session: RenderSession): boolean {
    const batches = session.view3d._meshBatches;
    const lights = session.lights;
    let hasCaster = false;

    for (let i = 0; i < lights.length; i++) {
      if (lights[i].castShadow) {
        hasCaster = true;
        break;
      }
    }

    if (hasCaster) {
      for (let i = 0; i < batches.length; i++) {
        if ((batches[i].drawLists[this.bit]?.view.count ?? 0) > 0) return true;
      }
    }

    return false;
  }

  /** `true` remaps shadow depth to [0,1] (WebGPU); `false` keeps [-1,1] (WebGL) */
  protected abstract readonly _applyZRangeFix: boolean;

  /**
   * The light's reusable inverse-light + projection scratch matrices, lazily created on
   * `light._gpuShadowData`
   *
   * Backends grow the returned {@link ShadowData} with their own cascade slots via
   * `ShadowRenderPassBase._cascadeSlot`.
   * @param light - The light whose shadow scratch data to resolve
   * @returns The light's backend shadow data
   */
  public getShadowGPUData(light: Light): S {
    return (light._gpuShadowData ??= {
      inverseLightMatrix: new Matrix4(),
      lightProjectionMatrix: new Matrix4(),
      // Born current: this light has drawn nothing into any earlier map, so it owes no re-render
      // for a discarded one. Its first layers come from the refresh a new light starts with
      // (`_shadowRefreshRequested`), which `updateLightShadowData` turns into `needsRender`.
      targetVersion: this.targetVersion,
    }) as S;
  }

  /**
   * The light's cascade slot at `cascadeIndex`, created with its camera group on first use
   *
   * A light only allocates the cascade indices it actually renders. Each cascade owns a camera
   * group rather than sharing one: on WebGPU `queue.writeBuffer` is queue-level, so writes before
   * submission are last-wins while the bundles all execute after them — a shared group would draw
   * every cascade with the final matrices. Slots live on the light keyed by identity, so the
   * upload pass and `render` read the same slot with no pool index to keep in agreement.
   * @param light - The shadow-casting light.
   * @param cascadeIndex - Which of the light's cascades.
   * @returns The cascade's slot.
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
   * Writes a freshly fitted cascade into its camera data
   *
   * The cascade is what its casters are drawn from, so its light-space view and its ortho or
   * perspective box go into the same shape a {@link Camera3D}'s camera data uses, bound at group 1
   * by the draws. Called with the light's scratch matrices still holding this cascade's fit; the
   * camera data takes copies.
   *
   * The cull volume is refreshed here too, so a cascade throttled off this frame keeps a frustum
   * that matches its frozen matrices. Every cascade projection already carries the toward-light
   * near extension, so the volume is exactly what the map rasterises.
   * @param slot - The cascade being fitted.
   * @param view - The cascade's light-space view matrix.
   * @param projection - The cascade's projection.
   */
  protected _commitCascadeCamera(slot: CascadeSlot, view: Matrix4, projection: Matrix4): void {
    // The eye is the view's inverse translation — exact for every fit (stable-fit cascades move
    // the light-space origin off the light node, so the node's own position would not match).
    tempEyeMatrix.getInverse(view);
    tempEyeMatrix.extractPosition(tempEye);

    const cameraData = slot.cameraData;

    cameraData.set(tempEye, view, projection);
    // No target-winding flip on a shadow map, so the draw matrix is also the cull matrix.
    cameraData.frustum.setFromProjectionMatrix(cameraData.viewProjection);
  }

  /** Serializes one populated cascade slot into the frame's shadow-data buffer at `slotIndex` */
  protected abstract _uploadSlot(slot: CascadeSlot, slotIndex: number, view3d: View3D): void;

  /**
   * Updates a light's shadow matrices and fills its cascade slot(s) with everything the
   * shadow data buffer needs — shared by both backends
   *
   * Spot lights fill slot 0 with a single perspective map. Directional lights
   * take one of two placements: with `shadow.cascades` set, camera-following
   * stable-fit cascades; otherwise a single fixed box — `shadow.bounds` if given,
   * else auto-fit to the scene's casters. Per cascade, the resolved `shadow.update`
   * cadence throttles re-rendering: `1` (default) every frame, `N` every Nth,
   * `0`/`'manual'` only when {@link Light.refreshShadows} forces it. A skipped
   * cascade keeps its frozen matrix and depth layer; the decision is recorded on
   * `cascade.needsRender` for `render()` to honour.
   *
   * Point lights are filtered out upstream and never reach here.
   * @param light - The shadow-casting light to update
   * @param view3d - The view whose camera and casters place the shadow volume
   */
  public updateLightShadowData(light: Light, view3d: View3D): void {
    if (!light.castShadow) return;

    const camera = view3d.camera;
    const shadowData = this.getShadowGPUData(light);
    const { inverseLightMatrix, lightProjectionMatrix } = shadowData;
    // The map this light drew into was discarded, so its layers are gone whatever the cadence says.
    // The frozen matrices stay valid — only the rasterisation has to happen again.
    const targetStale = shadowData.targetVersion !== this.targetVersion;
    const mapSize = SHADOW_QUALITY_SIZE[this._quality];
    const forceUpdate = light._shadowRefreshRequested;
    const update = light.shadow.update;
    const bias = light.shadow.bias ?? DEFAULT_SHADOW_BIAS;

    // Spot: single perspective map. Directional without cascades: single fixed box.
    // Both fill slot 0 with `cascadeCount = 0` (the shader treats it as a plain shadow).
    if (light.type === 'spot' || light.shadow.cascades === undefined) {
      const slot = this._cascadeSlot(light, 0);
      const renderSkip = cascadeRenderSkip(updateRateFor(update, 0), this._frameCount, forceUpdate);

      if (!renderSkip) {
        if (light.type === 'spot') {
          updateSpotShadowMatrices(light as SpotLight, inverseLightMatrix, lightProjectionMatrix, this._applyZRangeFix);
          this._commitCascadeCamera(slot, inverseLightMatrix, lightProjectionMatrix);
          slot.normalBias = light.shadow.normalBias ?? SPOT_SHADOW_NORMAL_BIAS;
        } else {
          // Fixed box: a user-supplied region (read live), or the auto-fit box.
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

    // Directional camera-fit: stable-fit cascades (constant ortho scale + texel snap).
    if (light.shadow.bounds !== undefined) warnOnce('pixi3d-shadow-bounds-cascades', WARN_BOUNDS_WITH_CASCADES);
    inverseLightMatrix.getInverse(light.worldTransform);

    const cascadeCount = cascadeCountFor(light);
    const lambda = light.shadow.lambda;

    // Cascades slice the camera frustum, which ends at the far plane — beyond it there is
    // nothing to slice and no receiver is ever drawn. Clamping packs the cascades into the
    // visible range, which makes every one of them sharper.
    const maxDist = Math.min(light.shadow.maxDistance ?? DEFAULT_CASCADE_MAX_DISTANCE, camera.far);

    // Cascade 0 owns the persistent split-depth scratch (filled in place, no
    // per-frame allocation); only it is packed into the shader (cascadeCount >
    // 1), so cascades 1+ stay null.
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
      // Cascade count + splits live on cascade 0 only; a lone cascade keeps
      // `cascadeCount = 0` so the shader treats it as a standard shadow.
      slot.cascadeCount = c === 0 && cascadeCount > 1 ? cascadeCount : 0;
      if (c > 0) slot.splits = null;
      slot.needsRender = targetStale || !renderSkip;
    }
  }

  /**
   * Marks a light's layers current after its shadow draws completed
   *
   * Its depth now belongs to the live map generation, and its one-shot refresh (if any) is
   * satisfied. Called from the backends' render loops rather than `updateLightShadowData`,
   * which runs every frame even when the pass is culled — so neither a forced refresh nor a
   * target loss is ever lost to a culled frame.
   * @param light - The light whose shadow draws just completed
   */
  protected _completeShadowUpdate(light: Light): void {
    if (light._gpuShadowData) light._gpuShadowData.targetVersion = this.targetVersion;
    light._shadowRefreshRequested = false;
  }

  /**
   * The auto-fit box for a directional light with no explicit `shadow.bounds`
   *
   * Cost is bounded by {@link MAX_AUTO_FIT_CASTERS}. At or under the cap the box is
   * re-fitted from the casters every rendered frame, so moved or added content just works.
   * Above it the walk is the expensive part, so the box is fitted once and frozen with a
   * one-time warn — on the *second* gather, because a light's first render can see
   * unsettled pass membership (e.g. a `castShadow: false` ground listed for one frame).
   * The caster count is O(batches) to read, so the live/frozen decision itself is free;
   * dropping back under the cap resumes live fitting, and {@link Light.fitShadowBounds}
   * re-fits a frozen box on demand. Returns `undefined` until the first non-empty gather.
   * @param light - The directional light being fitted
   * @param view3d - The view whose casters the box encloses
   * @param mapSize - Shadow-map size in texels, for the large-box warning
   */
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
    } else if (prev !== null) {
      // Over the cap with membership settled — this gather is the last free one.
      light._autoShadowBoundsFrozen = true;
      warnOnce(
        'pixi3d-shadow-autofit-cap',
        `Shadow auto-fit: ${casterCount} shadow casters is over the auto-measure cap (${MAX_AUTO_FIT_CASTERS}), ` +
          `so the shadow box was fitted once and frozen. If casters move or spawn outside it, set shadow.bounds, ` +
          `enable shadow.cascades, or call light.fitShadowBounds() after changes.`,
      );
    }

    this._warnIfShadowBoxLarge(box, mapSize);
    return box;
  }

  /**
   * Shadow casters in the view's pass membership this frame — the auto-fit live/frozen gate
   *
   * {@link BatchedMesh3D} instances count individually, so instanced content trips
   * the cap by design. O(batches), so cheap enough to sum on demand.
   * @param view3d - The view whose shadow casters to count
   */
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
   * World-space AABB over every shadow caster in the view — what a directional light's
   * auto-fit box tracks
   *
   * Cached per frame so multiple lights re-fitting on the same frame walk the casters
   * once. Scene-mesh bounding spheres are already world-space; a {@link BatchedMesh3D}'s
   * are batch-local, so they're lifted by the batch's world matrix. Dynamic
   * geometry (no registered bounds) is skipped. No casters → an empty box.
   * @param view3d - The view whose casters to enclose
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

      // Scene batch (0): spheres already in world space. User batches: batch-local → lift by B.
      const batchMatrix = b === 0 ? null : batch.renderData.worldTransform;
      const items = list.view.items;
      const indices = list.view.indices;

      for (let i = 0; i < list.view.count; i++) {
        // Slots are a StableList with null holes; the pass view's compaction can lag a
        // frame behind a removal, so a live index may briefly point at a freed slot.
        const item = items[indices[i]];
        if (!item) continue;

        const sphere = item.boundingSphere;
        if (sphere.radius < 0) continue;

        const world = batchMatrix ? sphere.applyMatrix4(batchMatrix, _scratchSphere) : sphere;
        box.union(world.getBounds(_scratchBox));
      }
    }

    return box;
  }

  /**
   * One-time hint when the auto-fit box is large enough that shadows read as soft — nudge toward cascades
   * @param bounds - The fitted shadow box
   * @param mapSize - Shadow-map size in texels
   */
  private _warnIfShadowBoxLarge(bounds: Box, mapSize: number): void {
    if (bounds.isEmpty()) return;

    const size = bounds.getSize(_scratchVec);
    if (Math.max(size.x, size.y, size.z) / mapSize > SHADOW_SOFT_TEXEL_THRESHOLD) {
      warnOnce('pixi3d-shadow-autofit-large', WARN_SHADOW_BOX_LARGE);
    }
  }

  /**
   * Normal-offset bias for a slot: the user value if set, else scaled to the shadow-map
   * texel's world size
   *
   * Ortho projection: `elements[0] = 2/width`, so `2/(elements[0]·mapSize)` is world
   * units per texel. Pushing the sample ~{@link SHADOW_NORMAL_BIAS_TEXELS} texels along
   * the surface normal keeps acne controlled whatever size box the auto-fit produced,
   * and avoids the peter-panning a fixed offset causes on a tight box. The shader scales
   * this down by `1 - N·L`, so the value here is the grazing-incidence maximum.
   * @param light - The light whose `shadow.normalBias` overrides the default
   * @param orthoProjection - The slot's orthographic projection, which sets a texel's world size
   * @param mapSize - Shadow-map size in texels
   */
  private _resolveNormalBias(light: Light, orthoProjection: Matrix4, mapSize: number): number {
    if (light.shadow.normalBias !== undefined) return light.shadow.normalBias;
    const texelWorld = 2 / (orthoProjection.elements[0] * mapSize);
    return SHADOW_NORMAL_BIAS_TEXELS * texelWorld;
  }

  /**
   * Prepares one light's shadow for the frame: claims its atlas slots (marking
   * non-casters unshadowed), computes its matrices, and uploads each slot into the
   * frame's shadow-data buffer, advancing the pass's own {@link ShadowRenderPassBase#shadowCount}
   *
   * The single per-light entry point the lighting systems call — the whole slot
   * protocol (claim → update → upload → count) stays inside the shadow pass, so
   * the lighting systems never track shadow state. A no-op for non-casters,
   * point lights, and over-budget lights (whose `_shadowDataIndex` it resets).
   * @param light - The light to prepare
   * @param view3d - The view being rendered
   */
  public prepareShadow(light: Light, view3d: View3D): void {
    const slots = this._claimShadowSlots(light);
    if (slots === 0) return;

    this._growAtlas(this._shadowCount + slots);
    this.updateLightShadowData(light, view3d);

    const cascades = this.getShadowGPUData(light).cascades!;
    for (let c = 0; c < slots; c++) {
      this._uploadSlot(cascades[c], this._shadowCount + c, view3d);
    }

    this._shadowCount += slots;
  }

  /**
   * Claims this frame's shadow-atlas slots for a caster that fits the remaining budget,
   * recording the base layer on `light._shadowDataIndex` and returning the cascade-slot
   * count claimed
   *
   * Returns `0` when the light isn't a caster (point lights never cast) or the budget
   * is full; over-budget casters are marked unshadowed (`_shadowDataIndex = -1`) with a
   * one-time dev warning.
   * @param light - The light claiming slots
   */
  private _claimShadowSlots(light: Light): number {
    const castsShadow = light.castShadow && light.type !== 'point';
    const cascadeCount = cascadeCountFor(light);

    if (castsShadow && this._shadowCount + cascadeCount <= MAX_SHADOW_SLOTS) {
      light._shadowDataIndex = this._shadowCount;
      return cascadeCount;
    }

    if (castsShadow) warnOnce('pixi3d-shadow-budget', WARN_SHADOW_BUDGET);

    light._shadowDataIndex = -1;
    return 0;
  }

  /**
   * Releases the shadow-map array render target this pass exclusively owns (lazily
   * created via {@link ShadowRenderPassBase#renderTarget}, reallocated on quality changes)
   *
   * Invoked by `RenderGraph.destroy` through `pass.destroy?.()`. The per-light
   * cascade bind groups (`Light._gpuShadowData`) and the View's bone pit are
   * owned elsewhere and freed on their own teardown, not here.
   */
  public override destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    // The view tears its global bind group down before it destroys the graph, so the release has
    // nothing left to unbind — dropping the back-reference keeps it from touching a dead view.
    this._view3d = null;
    this._releaseTarget();

    super.destroy();
  }
}
