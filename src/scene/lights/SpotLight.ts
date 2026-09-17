import { definedProps } from 'pixi.js';

import { Light } from './Light';
import type { LightOptions } from './Light';

/**
 * Constructor options for {@link SpotLight}
 *
 * Adds cone-shape fields ({@link SpotLightOptions.range | range},
 * {@link SpotLightOptions.coneAngle | coneAngle},
 * {@link SpotLightOptions.penumbra | penumbra}) on top of {@link LightOptions}.
 * @category scene
 * @standard
 */
export interface SpotLightOptions extends LightOptions {
  /**
   * Maximum distance (in world units) over which this light contributes
   *
   * `0` means infinite range.
   * @default 0
   */
  range?: number;
  /**
   * Half-angle of the cone in degrees: the angle between the cone's central axis and its edge
   *
   * The default is a 60° half-angle, so a 120° cone.
   * @default 60
   */
  coneAngle?: number;
  /**
   * Soft edge of the cone, expressed as a fraction of {@link SpotLightOptions.coneAngle | coneAngle}
   *
   * `0` is a hard-edged cone; `1` fades from the center to the edge.
   * @default 0
   */
  penumbra?: number;
}

/**
 * Directional cone emitter radiating from a world-space position outward along
 * the cone's central axis
 *
 * The cone has a configurable half-angle and soft edge. The light's central
 * axis is its local **-Z** transformed by its world matrix; aim it with
 * {@link Container3D.lookAt | lookAt}.
 *
 * Intensity falls off both with cone angle (hard cutoff at the edge,
 * smoothly faded over the {@link SpotLight.penumbra | penumbra} band) and
 * with distance (inverse-square, windowed to zero at {@link SpotLight.range}
 * when range is non-zero).
 *
 * Spot lights support shadow casting via a single perspective shadow
 * frustum framed to the cone.
 * @example
 * ```ts
 * import { SpotLight } from '@pixi/3d';
 *
 * const flashlight = new SpotLight({
 *   color: 0xffffff,
 *   intensity: 10,
 *   range: 25,
 *   coneAngle: 30,   // 30° half-angle (60° cone)
 *   penumbra: 0.25,  // soft edge over the outer quarter
 *   castShadow: true,
 * });
 * flashlight.position.set(0, 3, 5);
 * flashlight.lookAt({ x: 0, y: 0, z: 0 });
 * view.root.addChild(flashlight);
 * ```
 * @see {@link Light} For the abstract base class.
 * @see {@link PointLight} For the omnidirectional alternative.
 * @category scene
 * @standard
 */
export class SpotLight extends Light {
  /**
   * Default {@link SpotLightOptions} merged under every constructor call
   *
   * `new SpotLight(opts)` resolves as
   * `{ ...SpotLight.defaultOptions, ...definedProps(opts) }`. Mutate to
   * change the defaults process-wide.
   */
  public static defaultOptions: SpotLightOptions = {
    color: 0xffffff,
    intensity: 1,
    castShadow: false,
    range: 0,
    coneAngle: 60,
    penumbra: 0,
  };

  /** Discriminator for the spot light kind */
  public readonly type = 'spot';

  /**
   * Maximum distance (in world units) over which this light contributes
   *
   * `0` disables the distance cutoff so only inverse-square falloff applies.
   * @default 0
   */
  public range: number;

  /**
   * Half-angle of the cone in degrees: the angle between the cone's central axis and its edge
   * @example
   * ```ts
   * spot.coneAngle = 30; // 30° half-angle, a 60° cone
   * ```
   * @default 60
   */
  public coneAngle: number;

  /**
   * Soft edge of the cone, expressed as a fraction of {@link SpotLight.coneAngle | coneAngle}
   *
   * `0` is a hard-edged cone; `1` fades from the center to the edge.
   * @default 0
   */
  public penumbra: number;

  /**
   * Creates a new `SpotLight`. Add it to a {@link View3D} by parenting it
   * under {@link View3D.root | view.root}.
   * @param options - construction options; see {@link SpotLightOptions}.
   */
  constructor(options: SpotLightOptions = {}) {
    const { range, coneAngle, penumbra, ...rest } = { ...SpotLight.defaultOptions, ...definedProps(options) };

    super({ label: 'SpotLight', ...rest });

    this.range = range!;
    this.coneAngle = coneAngle!;
    this.penumbra = penumbra!;
  }
}
