import { Color } from 'pixi.js';
import type { ColorSource } from 'pixi.js';

import type { CascadeSlot } from '../../core/render-passes/shadow/shadowPassUtils';
import { releaseShadowCascades } from '../../core/render-passes/shadow/shadowPassUtils';
import type { Matrix4 } from '../../math/matrix/Matrix4';
import type { Box } from '../../math/shapes/Box';
import type { Destroy3DOptions } from '../../utils/Destroy3DOptions';
import { Container3D } from '../Container3D';
import type { Container3DOptions } from '../Container3D';

/**
 * Discriminator for the four concrete light kinds
 *
 * Materials and the lighting system branch on this string to pick the right
 * per-pixel evaluation path.
 * @see {@link Light.type} For the field that carries this tag.
 * @see {@link AmbientLight}, {@link DirectionalLight}, {@link PointLight}, {@link SpotLight}
 *      For the concrete subclasses.
 * @category scene
 * @standard
 */
export type LightType = 'directional' | 'point' | 'spot' | 'ambient';

/**
 * Shadow tuning shared by both placement modes (and spot lights)
 * @see {@link LightShadowOptions} For the full option set.
 * @category scene
 * @standard
 */
export interface LightShadowCommonOptions {
  /**
   * Depth bias to reduce shadow acne
   * @default 0.001
   */
  bias?: number;
  /**
   * Normal-offset bias to reduce shadow acne on curved surfaces
   *
   * Defaults to an offset derived from the shadow-map texel size (spot
   * lights: `0.1`).
   */
  normalBias?: number;
}

/**
 * Fixed-box shadow placement — the default for directional lights
 *
 * The shadowed region is a world-space box: auto-fitted to the scene's
 * casters, or pinned explicitly via {@link LightShadowBoundsOptions.bounds | bounds}.
 * @category scene
 * @standard
 */
export interface LightShadowBoundsOptions extends LightShadowCommonOptions {
  /**
   * World-space region to shadow, as an axis-aligned {@link Box}
   *
   * Directional lights only. Omitted → the box auto-fits the scene's shadow
   * casters (re-fitted every frame up to a few hundred casters; larger scenes
   * fit once and freeze — see {@link Light.fitShadowBounds}), so
   * `castShadow: true` alone gives a stable, well-sized shadow. Set it to take
   * manual control: the box is read live, so mutating it each frame (e.g.
   * keeping it centred on the player) is free.
   */
  bounds?: Box;
  /** The other placement mode — see {@link LightShadowCascadesOptions} */
  cascades?: never;
  /**
   * How often the shadow re-renders: `1` every frame, `N` every Nth
   * frame, `'manual'` only when {@link Light.refreshShadows} is called
   * @default 1
   */
  update?: number | 'manual';
  /** Cascaded mode only — see {@link LightShadowCascadesOptions.maxDistance} */
  maxDistance?: never;
  /** Cascaded mode only — see {@link LightShadowCascadesOptions.lambda} */
  lambda?: never;
}

/**
 * Camera-following cascaded shadow maps (CSM) for large / roaming scenes
 *
 * Mutually exclusive with {@link LightShadowBoundsOptions.bounds | bounds}:
 * cascades follow the camera, a bounds box pins a fixed region.
 * @category scene
 * @standard
 */
export interface LightShadowCascadesOptions extends LightShadowCommonOptions {
  /**
   * Number of splits along the view distance (1–4)
   *
   * Directional lights only. `1` follows the camera with a single un-split map.
   */
  cascades: 1 | 2 | 3 | 4;
  /** The other placement mode — see {@link LightShadowBoundsOptions} */
  bounds?: never;
  /**
   * How often the shadow re-renders: `1` every frame, `N` every Nth
   * frame, `[a, b, …]` per cascade, `'manual'` only when
   * {@link Light.refreshShadows} is called
   * @default 1
   */
  update?: number | number[] | 'manual';
  /**
   * How far from the camera cascades reach, in world units
   * @default 50
   */
  maxDistance?: number;
  /**
   * Split distribution — `0` uniform … `1` logarithmic
   * @default 0.5
   */
  lambda?: number;
}

/**
 * Shadow configuration accepted on {@link LightOptions.shadow}
 *
 * One of two mutually exclusive placement modes for directional lights: a
 * fixed box ({@link LightShadowBoundsOptions}, the default — auto-fit, or
 * explicit `bounds`) or camera-following cascades
 * ({@link LightShadowCascadesOptions}). Passing `bounds` and `cascades`
 * together is a type error; missing fields fall back to {@link Light}'s
 * `shadow` defaults. Only consulted when
 * {@link LightOptions.castShadow | castShadow} is `true`.
 * @see {@link Light.shadow} For the resolved shadow state on a constructed light.
 * @category scene
 * @standard
 */
export type LightShadowOptions = LightShadowBoundsOptions | LightShadowCascadesOptions;

/**
 * Resolved shadow state stored on every {@link Light}
 *
 * Same shape as {@link LightShadowOptions} but with required fields filled in
 * from defaults. Mutating any field is a free per-frame update — the shadow
 * render pass re-reads these values each frame.
 * @category scene
 * @standard
 */
export interface LightShadow {
  /**
   * World-space region to shadow (directional lights)
   *
   * `undefined` → auto-fit to the scene's casters — live under the pass's
   * caster cap, frozen above it. Ignored when {@link LightShadow.cascades}
   * is set.
   */
  bounds: Box | undefined;
  /** Cascade count (1–4) for camera-following CSM, or `undefined` for the fixed box */
  cascades: 1 | 2 | 3 | 4 | undefined;
  /**
   * Re-render cadence: `1` every frame, `N` every Nth, `number[]` per cascade,
   * `'manual'` only on {@link Light.refreshShadows}
   */
  update: number | number[] | 'manual';
  /** Cascaded only: camera distance cascades cover, or `undefined` for the `50` default */
  maxDistance: number | undefined;
  /** Cascaded only: split distribution — `0` uniform … `1` logarithmic */
  lambda: number;
  /** Depth bias, or `undefined` for the `0.001` default */
  bias: number | undefined;
  /**
   * Normal-offset bias at grazing incidence, or `undefined` to derive from the shadow-map
   * texel size
   *
   * Receivers are nudged along their normal before the depth compare, by this much where the
   * light only grazes the surface and tapering to nothing where it strikes head-on. Raise it
   * if shadowed surfaces show striping; lower it if shadows pull away from their casters.
   */
  normalBias: number | undefined;
}

/**
 * Constructor options common to every {@link Light}
 *
 * Concrete subclasses extend this with their own fields (e.g.
 * {@link PointLightOptions.range}). Inherited {@link Container3DOptions}
 * (`label`, `position`, `eventMode`, …) are applied too.
 * @example
 * ```ts
 * const sun = new DirectionalLight({ color: 0xfff4e0, intensity: 3, castShadow: true, label: 'sun' });
 * ```
 * @see {@link Light} For the constructed instance and runtime accessors.
 * @category scene
 * @standard
 */
export interface LightOptions extends Container3DOptions {
  /**
   * Light color. Any {@link ColorSource} (hex, CSS string, `Color`, `[r,g,b]`, `{r,g,b}`)
   * @default 0xffffff
   */
  color?: ColorSource;
  /**
   * Linear intensity multiplier applied to {@link LightOptions.color | color}
   * @default 1
   */
  intensity?: number;
  /**
   * Whether this light writes into the shadow pass
   * @default false
   */
  castShadow?: boolean;
  /** Shadow configuration. Only consulted when {@link LightOptions.castShadow | castShadow} is `true` */
  shadow?: LightShadowOptions;
}

/**
 * GPU-side state cached on every shadow-casting {@link Light}
 *
 * Populated by the shadow render pass; not part of the public API.
 * @internal
 */
export interface ShadowData {
  /** Inverse light world transform — scratch reused by every shadow path */
  inverseLightMatrix: Matrix4;
  /** Light projection — scratch reused as the cascade / single-map projection out-param */
  lightProjectionMatrix: Matrix4;
  /**
   * Per-cascade slots (one per cascade), lazily grown. Cascade 0's
   * `cameraData.viewProjection` is the light's primary view-projection.
   */
  cascades?: CascadeSlot[];
  /**
   * The shadow pass's `targetVersion` this light's layers were last rendered into. When the pass
   * discards its map, the mismatch is what makes this light re-rasterise its cascades instead of
   * trusting depth that no longer exists.
   */
  targetVersion?: number;
}

/**
 * Abstract base for every light in the scene
 *
 * A `Light` is a {@link Container3D}, so it participates in the scene-graph
 * transform hierarchy — position it, parent it, animate it like any other
 * node. Add lights to a scene by parenting them under
 * {@link View3D.root | view.root} (or any descendant); the View tracks them
 * automatically.
 *
 * `Light` itself is not constructible — use one of the four concrete
 * subclasses. Each subclass picks a different shading model:
 *
 * - {@link AmbientLight}    — uniform fill applied to every fragment.
 * - {@link DirectionalLight} — parallel rays (sun-like); supports CSM shadows.
 * - {@link PointLight}      — omnidirectional point emitter with optional range falloff.
 * - {@link SpotLight}       — cone emitter with angle / penumbra / range falloff.
 *
 * Lights face local **-Z** by convention (so `light.lookAt(target)` orients
 * the light's -Z toward `target` — the same convention used by {@link Camera3D}).
 * @example
 * ```ts
 * import { View3D, DirectionalLight, AmbientLight } from '@pixi/3d';
 *
 * const view = new View3D({ width: 800, height: 600 });
 *
 * // Sun-like key light with cascaded shadows.
 * const sun = new DirectionalLight({ intensity: 3, castShadow: true });
 * sun.position.set(5, 10, 5);
 * sun.lookAt({ x: 0, y: 0, z: 0 });
 * view.root.addChild(sun);
 *
 * // Cheap fill so shadowed areas aren't pitch black.
 * view.root.addChild(new AmbientLight({ intensity: 0.3 }));
 * ```
 * @see {@link View3D} For the scene root that hosts lights.
 * @see {@link Mesh3D} For the renderable type lit by these lights.
 * @see {@link Container3D} For the scene-graph base class.
 * @category scene
 * @standard
 */
export abstract class Light extends Container3D {
  /** Discriminator filled in by each concrete subclass */
  public abstract readonly type: LightType;

  /**
   * Light color
   *
   * Combines multiplicatively with {@link Light.intensity} into the
   * per-fragment radiance contribution. Mutate freely — the lighting system
   * re-reads this each frame.
   * @default 0xffffff
   */
  public color: Color;

  /**
   * Linear intensity multiplier applied to {@link Light.color}
   *
   * {@link AmbientLight} defaults to `0.5`. Higher values are
   * physically valid; tone mapping (see {@link View3D.toneMapping}) compresses
   * the resulting radiance into displayable range.
   * @default 1
   */
  public intensity: number;

  /**
   * Whether this light writes into the shadow pass
   *
   * Runtime changes take effect on the next frame. When a rendered light first casts a shadow, the
   * view compiles shadow sampling into its lit material shaders. Later toggles keep that sampler in
   * the shaders.
   * @default false
   * @see {@link Light.shadow} For per-light shadow tuning.
   * @see {@link View3DOptions} For `shadowQuality`, which sets the shadow-map resolution.
   */
  public castShadow = false;

  /**
   * Whether this light casts a shadow: {@link Light.castShadow | castShadow} is on and its kind
   * can cast
   *
   * Point and ambient lights never do, whatever `castShadow` says.
   */
  get canCastShadow(): boolean {
    return this.castShadow;
  }

  /**
   * Per-light shadow tuning
   *
   * Mutate fields directly for free per-frame updates; the shadow pass
   * re-reads them each frame.
   * @see {@link LightShadow} For the field list and semantics.
   */
  public shadow: LightShadow;

  /**
   * Lights face local -Z (so `light.lookAt(target)` orients -Z toward target)
   * Set on every `Light` subclass; consumed by {@link Container3D.lookAt}.
   * @internal
   */
  protected override _lookAtForwardIsPositiveZ = false;

  /**
   * GPU-side cached shadow state (matrices + bind group). Populated by the
   * shadow render pass; `null` when this light isn't currently casting.
   * @internal
   */
  public _gpuShadowData: ShadowData | null = null;

  /**
   * Slot index into the `uShadowData` uniform for the current frame, or
   * `-1` when this light isn't writing a shadow this frame.
   * @internal
   */
  public _shadowDataIndex: number = -1;

  /**
   * Flag consumed by `ShadowRenderPass` to force a one-shot re-render of all
   * cascades, then auto-cleared. Set via {@link Light.refreshShadows}.
   * @internal
   */
  public _shadowRefreshRequested = true;

  /**
   * Auto-fit shadow box for a directional light with no explicit
   * {@link LightShadow.bounds | bounds}. The shadow pass re-fits it from
   * the scene's casters every rendered frame while the caster count is within its
   * auto-measure cap, and freezes it at the last fit above the cap. `null` until
   * the first gather.
   * @internal
   */
  public _autoShadowBounds: Box | null = null;

  /**
   * `true` while `_autoShadowBounds` is frozen — the scene has more casters
   * than the pass's auto-measure cap, so per-frame re-fitting stopped.
   * Cleared by {@link Light.fitShadowBounds} (and automatically when the count
   * drops back under the cap).
   * @internal
   */
  public _autoShadowBoundsFrozen = false;

  /**
   * Creates a new `Light`. Called by concrete subclasses — `Light` itself is
   * abstract.
   * @param options - construction options; see {@link LightOptions}.
   */
  constructor(options: LightOptions) {
    const { color, intensity, castShadow, shadow: s, ...rest } = options;

    super(rest);

    this.color = new Color(color);
    this.intensity = intensity ?? 1;
    this.castShadow = castShadow ?? false;

    this.shadow = {
      bounds: undefined,
      cascades: undefined,
      update: 1,
      maxDistance: undefined,
      lambda: 0.5,
      bias: undefined,
      normalBias: undefined,
    };

    if (s) {
      if (s.bounds !== undefined) this.shadow.bounds = s.bounds;
      if (s.cascades !== undefined) this.shadow.cascades = s.cascades;
      if (s.update !== undefined) this.shadow.update = s.update;
      if (s.maxDistance !== undefined) this.shadow.maxDistance = s.maxDistance;
      if (s.lambda !== undefined) this.shadow.lambda = s.lambda;
      if (s.bias !== undefined) this.shadow.bias = s.bias;
      if (s.normalBias !== undefined) this.shadow.normalBias = s.normalBias;
    }
  }

  /**
   * Request a shadow refresh on the next frame
   *
   * In `update: 'manual'` mode this is the only thing that triggers a
   * re-render; in every-frame mode it forces a one-shot refresh (e.g. after a
   * scene change).
   * @example
   * ```ts
   * sun.shadow.update = 'manual';
   * // ...later, after the scene changes:
   * sun.refreshShadows();
   * ```
   */
  public refreshShadows(): void {
    this._shadowRefreshRequested = true;
  }

  /**
   * Re-fit the auto-fit shadow box to the scene's casters on the next frame,
   * then re-render
   *
   * Small scenes never need this — up to a few hundred casters the box re-fits
   * automatically every frame. Above that cap the shadow pass fits the box once
   * and freezes it (re-measuring tens of thousands of instanced casters every
   * frame would be a hidden per-frame cost), so call this after moving or
   * spawning content outside the frozen box. A no-op for cascaded lights, spot
   * lights, and lights with an explicit {@link LightShadow.bounds | bounds}.
   * @example
   * ```ts
   * spawnCity(); // 50k instanced casters — the auto-fit box froze at first fit
   * sun.fitShadowBounds(); // one re-measure so the new content is inside the box
   * ```
   */
  public fitShadowBounds(): void {
    this._autoShadowBoundsFrozen = false;
    this._shadowRefreshRequested = true;
  }

  /**
   * Drops the cached per-cascade GPU state: the shadow bind groups, which bind the owning
   * View's bone-pit buffer, and the exempt cascade UBOs they own
   *
   * The shadow pass builds a fresh set the next time this light casts. Runs when the light
   * leaves a View, when the View unloads, and on destroy, so no bind group can outlive the
   * bone pit it binds. The shared resources bound alongside (the bone-pit buffer, the empty
   * texture) are left intact. Idempotent.
   * @internal
   */
  public _releaseShadowState(): void {
    if (!this._gpuShadowData) return;

    releaseShadowCascades(this._gpuShadowData);
    this._gpuShadowData = null;
  }

  /**
   * Releases this light's owned GPU shadow state and detaches it from the
   * scene graph so the lighting system stops tracking it
   *
   * Idempotent — a second call is a no-op via the inherited
   * {@link Container3D.destroyed} guard.
   * @param options - forwarded to {@link Container3D.destroy}.
   */
  public override destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;

    this._releaseShadowState();

    this._shadowDataIndex = -1;
    this._shadowRefreshRequested = false;
    this._autoShadowBounds = null;
    this._autoShadowBoundsFrozen = false;

    super.destroy(options);
  }
}
