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
 * The four kinds of {@link Light}, as a light's {@link Light.type | type} reports them
 * @example
 * ```ts
 * const suns = view.lights.filter((light: Light) => light.type === 'directional');
 * ```
 * @see {@link Light.type} For the field that carries this tag.
 * @see {@link AmbientLight}, {@link DirectionalLight}, {@link PointLight}, {@link SpotLight}
 *      For the concrete subclasses.
 * @category scene
 * @standard
 */
export type LightType = 'directional' | 'point' | 'spot' | 'ambient';

/**
 * Shadow options every shadow-casting light takes, whichever way its shadow is placed
 * @example
 * ```ts
 * const tuning: LightShadowCommonOptions = { bias: 0.002, normalBias: 0.05 };
 * const sun = new DirectionalLight({ castShadow: true, shadow: { cascades: 3, ...tuning } });
 * ```
 * @see {@link LightShadowOptions} For the full option set.
 * @category scene
 * @standard
 */
export interface LightShadowCommonOptions {
  /**
   * Depth offset that keeps a surface from shadowing itself; see {@link LightShadow.bias}
   * @default 0.001
   * @example
   * ```ts
   * const sun = new DirectionalLight({ castShadow: true, shadow: { bias: 0.002 } });
   * ```
   */
  bias?: number;
  /**
   * Offset along the surface normal that keeps a surface from shadowing itself; see
   * {@link LightShadow.normalBias}
   * @example
   * ```ts
   * const sun = new DirectionalLight({ castShadow: true, shadow: { normalBias: 0.05 } });
   * ```
   */
  normalBias?: number;
}

/**
 * Shadow options for one shadow map over a fixed world-space box, the default placement
 *
 * The box is fitted to the scene's shadow casters, or set with
 * {@link LightShadowBoundsOptions.bounds | bounds}. Suits a scene that fits in one view, such as
 * a room, an arena or a board. A spot light takes these options but ignores `bounds`: its shadow
 * covers its cone.
 * @example
 * ```ts
 * const sun = new DirectionalLight({
 *   castShadow: true,
 *   shadow: { bounds: Box.fromCenterSize({ x: 0, y: 0, z: 0 }, 40), update: 'manual' },
 * });
 * ```
 * @category scene
 * @standard
 */
export interface LightShadowBoundsOptions extends LightShadowCommonOptions {
  /**
   * World-space box a directional light's shadow covers; see {@link LightShadow.bounds}
   * @example
   * ```ts
   * const sun = new DirectionalLight({ castShadow: true, shadow: { bounds: Box.fromCenterSize(arena.position, 30) } });
   * ```
   */
  bounds?: Box;
  /**
   * Not available with a fixed box; cascades are the other placement, see
   * {@link LightShadowCascadesOptions}
   * @hidden
   */
  cascades?: never;
  /**
   * How often the shadow redraws; see {@link LightShadow.update}
   * @default 1
   * @example
   * ```ts
   * const sun = new DirectionalLight({ castShadow: true, shadow: { update: 4 } });
   * ```
   */
  update?: number | 'manual';
  /**
   * Not available with a fixed box; see {@link LightShadowCascadesOptions.maxDistance}
   * @hidden
   */
  maxDistance?: never;
  /**
   * Not available with a fixed box; see {@link LightShadowCascadesOptions.lambda}
   * @hidden
   */
  lambda?: never;
}

/**
 * Shadow options for cascaded shadow maps, which follow the camera, for a directional light
 *
 * The camera's view is cut into slices by distance, and each slice gets its own shadow map, so
 * nearby shadows stay sharp however large the world is. Suits open worlds and anything the
 * camera roams across. Spot lights ignore cascades.
 * @example
 * ```ts
 * const sun = new DirectionalLight({ castShadow: true, shadow: { cascades: 3, maxDistance: 80 } });
 * ```
 * @category scene
 * @standard
 */
export interface LightShadowCascadesOptions extends LightShadowCommonOptions {
  /**
   * How many slices the camera's view is cut into; see {@link LightShadow.cascades}
   * @example
   * ```ts
   * const sun = new DirectionalLight({ castShadow: true, shadow: { cascades: 4 } });
   * ```
   */
  cascades: 1 | 2 | 3 | 4;
  /**
   * Not available with cascades; a fixed box is the other placement, see
   * {@link LightShadowBoundsOptions}
   * @hidden
   */
  bounds?: never;
  /**
   * How often each cascade redraws; see {@link LightShadow.update}
   * @default 1
   * @example
   * ```ts
   * const sun = new DirectionalLight({ castShadow: true, shadow: { cascades: 3, update: [1, 2, 8] } });
   * ```
   */
  update?: number | number[] | 'manual';
  /**
   * How far from the camera the cascades reach, in world units; see {@link LightShadow.maxDistance}
   * @default 50
   * @example
   * ```ts
   * const sun = new DirectionalLight({ castShadow: true, shadow: { cascades: 3, maxDistance: 120 } });
   * ```
   */
  maxDistance?: number;
  /**
   * How the distance is shared out between cascades; see {@link LightShadow.lambda}
   * @default 0.5
   * @example
   * ```ts
   * const sun = new DirectionalLight({ castShadow: true, shadow: { cascades: 3, lambda: 0.8 } });
   * ```
   */
  lambda?: number;
}

/**
 * Shadow options a light takes, in one of two placements
 *
 * A fixed box ({@link LightShadowBoundsOptions}) is the default: one shadow map over the scene's
 * shadow casters, or over the `bounds` you give. Cascades ({@link LightShadowCascadesOptions})
 * follow the camera instead. Passing `bounds` and `cascades` together is a type error. Fields
 * left out take their defaults. Only read while {@link LightOptions.castShadow | castShadow} is
 * `true`.
 * @example
 * ```ts
 * const shadow: LightShadowOptions = openWorld ? { cascades: 3, maxDistance: 80 } : { bounds: arenaBounds };
 * const sun = new DirectionalLight({ castShadow: true, shadow });
 * ```
 * @see {@link Light.shadow} For the resolved shadow state on a constructed light.
 * @category scene
 * @standard
 */
export type LightShadowOptions = LightShadowBoundsOptions | LightShadowCascadesOptions;

/**
 * A light's shadow settings, as {@link Light.shadow} holds them
 *
 * The same fields as {@link LightShadowOptions}, with the defaults filled in. The shadow pass
 * reads them every frame, so a change shows on the next one. Nothing stops both `bounds` and
 * `cascades` being set here; cascades then win and a warning says so.
 * @example
 * ```ts
 * sun.shadow.cascades = 3;
 * sun.shadow.maxDistance = 60;
 * ```
 * @category scene
 * @standard
 */
export interface LightShadow {
  /**
   * World-space box a directional light's shadow covers, or `undefined` to fit the box to the
   * scene's shadow casters
   *
   * The fitted box is measured again every frame while the view has 256 shadow casters or fewer,
   * so `castShadow: true` alone gives a well-sized shadow. Past 256, measuring would cost every
   * frame, so the box is measured once and then kept; call {@link Light.fitShadowBounds} after
   * the scene changes. Set a box to take control: it is read every frame, so moving it, say to
   * follow the player, costs nothing extra. Ignored when {@link LightShadow.cascades} is set.
   * @example
   * ```ts
   * sun.shadow.bounds = Box.fromCenterSize(player.position, 30);
   * ```
   */
  bounds: Box | undefined;
  /**
   * How many slices the camera's view is cut into, each with its own shadow map, from 1 to 4;
   * `undefined` for a fixed box
   *
   * Directional lights only. More cascades keep distant shadows sharper, at the cost of drawing
   * the shadow casters once per cascade. `1` follows the camera with one map.
   * @example
   * ```ts
   * sun.shadow.cascades = isMobile ? 2 : 4;
   * ```
   */
  cascades: 1 | 2 | 3 | 4 | undefined;
  /**
   * How often the shadow redraws
   *
   * `1` redraws every frame and `N` every Nth frame. `'manual'`, or `0`, redraws only when
   * {@link Light.refreshShadows} asks. With cascades, an array gives each cascade its own rate,
   * and a cascade the array leaves out redraws every frame. A shadow that doesn't redraw keeps
   * the last one it drew, which suits a scene that doesn't move.
   * @example
   * ```ts
   * sun.shadow.update = [1, 2, 8];
   * ```
   */
  update: number | number[] | 'manual';
  /**
   * How far from the camera the cascades reach, in world units, or `undefined` for 50
   *
   * Cascades only. They never reach past the camera's far plane, so the
   * {@link Camera3D.far | far} value caps this. A shorter reach gives sharper shadows.
   * @example
   * ```ts
   * sun.shadow.maxDistance = 30;
   * ```
   */
  maxDistance: number | undefined;
  /**
   * How the distance is shared out between cascades, from `0` to `1`
   *
   * `0` gives every cascade an equal slice. `1` gives the nearest cascades the thinnest slices,
   * so the shadows closest to the camera get the most detail. Cascades only.
   * @example
   * ```ts
   * sun.shadow.lambda = 0.8;
   * ```
   */
  lambda: number;
  /**
   * Depth offset that keeps a surface from shadowing itself, or `undefined` for 0.001
   *
   * It is a fraction of the shadow map's depth range. Raise it if lit surfaces show stripes of
   * shadow (shadow acne); too much makes shadows start away from their casters.
   * @example
   * ```ts
   * sun.shadow.bias = 0.002;
   * ```
   */
  bias: number | undefined;
  /**
   * Offset along the surface normal that keeps a surface from shadowing itself, in world units,
   * or `undefined` for the default
   *
   * A surface the light only grazes moves this far along its normal before its shadow is
   * looked up, and a surface facing the light barely moves. The default is three shadow-map
   * texels for a directional light, so it follows the shadow's resolution, and 0.15 for a spot
   * light. Raise it if shadowed surfaces show striping; lower it if shadows pull away from their
   * casters.
   * @example
   * ```ts
   * sun.shadow.normalBias = 0.05;
   * ```
   */
  normalBias: number | undefined;
}

/**
 * Constructor options common to every {@link Light}
 *
 * Each kind of light adds its own, such as {@link PointLightOptions.range}. The
 * {@link Container3DOptions} (`label`, `position`, `eventMode`, …) apply too.
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
   * Colour of the light, as any {@link ColorSource}; see {@link Light.color}
   * @default 0xffffff
   * @example
   * ```ts
   * const candle = new PointLight({ color: '#ffb46b', range: 3 });
   * ```
   */
  color?: ColorSource;
  /**
   * Brightness; see {@link Light.intensity}
   * @default 1
   * @example
   * ```ts
   * const sun = new DirectionalLight({ intensity: 3 });
   * ```
   */
  intensity?: number;
  /**
   * Whether the light casts shadows; see {@link Light.castShadow}
   * @default false
   * @example
   * ```ts
   * const sun = new DirectionalLight({ castShadow: true });
   * ```
   */
  castShadow?: boolean;
  /**
   * Shadow settings, read only while `castShadow` is `true`; see {@link LightShadowOptions}
   * @example
   * ```ts
   * const sun = new DirectionalLight({ castShadow: true, shadow: { cascades: 3 } });
   * ```
   */
  shadow?: LightShadowOptions;
}

/**
 * GPU-side state cached on every shadow-casting {@link Light}, populated by the shadow render pass
 * @internal
 */
export interface ShadowData {
  /** Inverse light world transform, scratch reused by every shadow path */
  inverseLightMatrix: Matrix4;
  /** Light projection, scratch reused as the cascade or single-map projection out-param */
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
 * Base class for every light in the scene
 *
 * A light is a {@link Container3D}: position it, parent it and animate it like any other node.
 * Add it anywhere under {@link View3D.root | view.root} and it lights the view; hide it to switch
 * it off. Lights face local **-Z**, like a {@link Camera3D}, so `light.lookAt(target)` aims it.
 *
 * Create one of the four kinds:
 *
 * - {@link AmbientLight}: the same light on every surface, whatever its direction.
 * - {@link DirectionalLight}: parallel rays from one direction, like the sun. Casts shadows.
 * - {@link PointLight}: light in every direction from a point, like a bulb.
 * - {@link SpotLight}: a cone of light from a point, like a torch. Casts shadows.
 *
 * A view draws up to 32 point, spot and directional lights and ignores the rest. Shadows share
 * 16 shadow maps: one per spot light or uncascaded sun, and one per cascade of a cascaded sun.
 * A shadow-casting light that doesn't fit draws without a shadow, and a warning says so.
 * @example
 * ```ts
 * import { View3D, DirectionalLight, AmbientLight } from '@pixi/3d';
 *
 * const view = new View3D({ width: 800, height: 600 });
 *
 * // Sun with a shadow fitted to the scene.
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
  /** Which kind of light this is; each subclass sets it */
  public abstract readonly type: LightType;

  /**
   * Colour of the light
   *
   * Given in display space like every colour in the engine, and multiplied by
   * {@link Light.intensity}. Change it at any time; the view reads it every frame.
   * @default 0xffffff
   * @example
   * ```ts
   * sun.color.setValue(0xff9a4d);
   * ```
   */
  public color: Color;

  /**
   * Brightness, multiplied into {@link Light.color}
   *
   * Values above 1 are fine: the view's tone mapping (see {@link View3D.toneMapping}) brings
   * bright light back into range. A point or spot light dims with the square of the distance, so
   * it needs a higher intensity than a directional light to look as bright.
   * @default 1
   * @example
   * ```ts
   * lamp.intensity = flicker ? 6 : 8;
   * ```
   */
  public intensity = 0;

  /**
   * Whether this light casts shadows; only directional and spot lights can
   *
   * A change takes effect on the next frame. The first time a light in a view casts, the view
   * recompiles its lit materials to sample shadows. They keep that code after the light stops
   * casting, so later toggles don't recompile anything.
   * @default false
   * @example
   * ```ts
   * torch.castShadow = settings.shadows;
   * ```
   * @see {@link Light.shadow} For per-light shadow tuning.
   * @see {@link View3DOptions} For `shadowQuality`, which sets the shadow-map resolution.
   */
  public castShadow = false;

  /**
   * Whether this light casts shadows: {@link Light.castShadow | castShadow} is on and its kind
   * can cast
   *
   * Point and ambient lights never do, whatever `castShadow` says.
   * @example
   * ```ts
   * const shadowCasters = view.lights.filter((light: Light) => light.canCastShadow);
   * ```
   */
  get canCastShadow(): boolean {
    return this.castShadow;
  }

  /**
   * This light's shadow settings; see {@link LightShadow}
   *
   * Change a field at any time and the next frame uses it.
   * @example
   * ```ts
   * sun.shadow.bias = 0.002;
   * ```
   */
  public shadow: LightShadow;

  /**
   * Lights face local -Z, unlike the +Z default `Container3D` gives meshes
   * @internal
   */
  protected override _lookAtForwardIsPositiveZ = false;

  /**
   * GPU-side cached shadow state, populated by the shadow render pass; `null` until the light
   * casts, and again after {@link Light._releaseShadowState}
   * @internal
   */
  public _gpuShadowData: ShadowData | null = null;

  /**
   * Slot index into the `uShadowData` uniform for the current frame, or `-1` when this light
   * isn't writing a shadow this frame
   * @internal
   */
  public _shadowDataIndex: number = -1;

  /**
   * Whether the shadow pass should redraw every cascade of this light once, whatever its
   * `update` rate; it clears the flag after the redraw
   *
   * Starts `true` so a new light draws its shadow on its first frame. Set by
   * {@link Light.refreshShadows}.
   * @internal
   */
  public _shadowRefreshRequested = true;

  /**
   * The fitted shadow box of a directional light with no {@link LightShadow.bounds | bounds},
   * or `null` until the shadow pass first measures the scene
   * @internal
   */
  public _autoShadowBounds: Box | null = null;

  /**
   * Whether `_autoShadowBounds` is being kept rather than measured each frame, because the
   * view has more shadow casters than the shadow pass measures every frame
   *
   * Cleared by {@link Light.fitShadowBounds}, and when the caster count drops back under the cap.
   * @internal
   */
  public _autoShadowBoundsFrozen = false;

  /**
   * Called by the subclasses; `Light` itself is abstract
   * @param options - Construction options; see {@link LightOptions}.
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
   * Redraws this light's shadow on the next frame, whatever its {@link LightShadow.update} rate
   *
   * With `update: 'manual'` this is the only thing that redraws the shadow. With a slower rate,
   * call it after a change that shouldn't wait for the next scheduled redraw.
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
   * Measures the scene again for the fitted shadow box on the next frame, then redraws the shadow
   *
   * A view with 256 shadow casters or fewer never needs this: the box is measured every frame.
   * Past 256 it is measured once and kept, so call this after moving or spawning casters outside
   * the box. Instances of a `BatchedMesh3D` count one each. For a cascaded light, a spot light,
   * or a light with its own {@link LightShadow.bounds | bounds}, it only redraws the shadow, like
   * {@link Light.refreshShadows}.
   * @example
   * ```ts
   * spawnCity(); // 50k instanced casters: the fitted box was measured once and kept
   * sun.fitShadowBounds(); // measure again so the new content is inside the box
   * ```
   */
  public fitShadowBounds(): void {
    this._autoShadowBoundsFrozen = false;
    this._shadowRefreshRequested = true;
  }

  /**
   * Drops the cached per-cascade GPU state: each cascade's camera data and, on WebGPU, its cull
   * results, whose bundles baked the shadow pass's bind group over the owning View's bone pit
   *
   * The shadow pass builds a fresh set the next time this light casts. Runs when the light
   * leaves a View, when the View unloads, and on destroy, so no recorded bundle can outlive the
   * bone pit it binds. The bone-pit buffer itself belongs to the View and is left intact.
   * Idempotent.
   * @internal
   */
  public _releaseShadowState(): void {
    if (!this._gpuShadowData) return;

    releaseShadowCascades(this._gpuShadowData);
    this._gpuShadowData = null;
  }

  /**
   * Removes the light from the scene and frees its shadow's GPU data
   *
   * Calling it again does nothing.
   * @example
   * ```ts
   * torch.destroy();
   * ```
   * @param options - Forwarded to {@link Container3D.destroy}.
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
