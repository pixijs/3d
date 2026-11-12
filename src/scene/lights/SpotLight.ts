import { definedProps } from 'pixi.js';

import { Light } from './Light';
import type { LightOptions } from './Light';

/**
 * Constructor options for {@link SpotLight}: the {@link LightOptions} plus the cone's
 * {@link SpotLightOptions.range | range}, {@link SpotLightOptions.radius | radius},
 * {@link SpotLightOptions.coneAngle | coneAngle} and {@link SpotLightOptions.penumbra | penumbra}
 * @example
 * ```ts
 * const options: SpotLightOptions = { intensity: 10, range: 25, coneAngle: 30, penumbra: 0.25 };
 * const flashlight = new SpotLight(options);
 * ```
 * @category scene
 * @standard
 */
export interface SpotLightOptions extends LightOptions {
  /**
   * Distance the light reaches, in world units; see {@link SpotLight.range}
   * @default 0
   * @example
   * ```ts
   * const streetLamp = new SpotLight({ intensity: 20, range: 8 });
   * ```
   */
  range?: number;
  /**
   * Radius of the light's bulb, in world units; see {@link SpotLight.radius}
   * @default 0.1
   * @example
   * ```ts
   * const wallLamp = new SpotLight({ intensity: 6, range: 4, radius: 0.5 });
   * ```
   */
  radius?: number;
  /**
   * Angle between the cone's axis and its edge, in degrees; see {@link SpotLight.coneAngle}
   * @default 60
   * @example
   * ```ts
   * const narrowBeam = new SpotLight({ coneAngle: 15 });
   * ```
   */
  coneAngle?: number;
  /**
   * How soft the cone's edge is, from `0` to `1`; see {@link SpotLight.penumbra}
   * @default 0
   * @example
   * ```ts
   * const softSpot = new SpotLight({ coneAngle: 30, penumbra: 0.5 });
   * ```
   */
  penumbra?: number;
}

/**
 * Light that shines in a cone from a point, like a torch or a stage light
 *
 * The cone points along the light's local **-Z** axis; aim it with
 * {@link Container3D.lookAt | lookAt}. Light stops at the cone's edge, softened by the
 * {@link SpotLight.penumbra | penumbra}, and dims with the square of the distance, fading to
 * nothing at the {@link SpotLight.range | range} when it has one.
 *
 * Its shadow is one perspective map that covers the cone from 1 world unit out to the range,
 * or out to 1000 with no range. Casters closer than 1 unit to the light cast no shadow. The
 * shadow needs a {@link SpotLight.coneAngle | coneAngle} under 90 degrees.
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
 * @see {@link PointLight} For the omnidirectional alternative.
 * @category scene
 * @standard
 */
export class SpotLight extends Light {
  /**
   * Defaults for every new `SpotLight`; an option passed as `undefined` keeps its default
   * @example
   * ```ts
   * SpotLight.defaultOptions.penumbra = 0.2;
   * ```
   */
  public static defaultOptions: SpotLightOptions = {
    color: 0xffffff,
    intensity: 1,
    castShadow: false,
    range: 0,
    radius: 0.1,
    coneAngle: 60,
    penumbra: 0,
  };

  /** Always `'spot'` */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- read-only discriminant
  public readonly type = 'spot';

  /**
   * Distance the light reaches, in world units, or `0` for no limit
   *
   * Works as {@link PointLight.range} does, and also sets how far the shadow reaches.
   * @default 0
   * @example
   * ```ts
   * flashlight.range = 25;
   * ```
   */
  public range = 0;

  /**
   * Radius of the light's bulb, in world units
   *
   * Works as {@link PointLight.radius} does; it doesn't soften the shadow.
   * @default 0.1
   * @example
   * ```ts
   * flashlight.radius = 0.5;
   * ```
   */
  public radius = 0.1;

  /**
   * Angle between the cone's axis and its edge, in degrees, so the cone is twice as wide
   * @example
   * ```ts
   * spot.coneAngle = 30; // a 60° cone
   * ```
   * @default 60
   */
  public coneAngle = 0;

  /**
   * How soft the cone's edge is, as a fraction of {@link SpotLight.coneAngle | coneAngle}
   *
   * The light is at full strength out to `coneAngle * (1 - penumbra)` and fades to nothing at
   * `coneAngle`. `0` gives a hard edge; `1` fades all the way from the axis.
   * @default 0
   * @example
   * ```ts
   * flashlight.penumbra = 0.25;
   * ```
   */
  public penumbra = 0;

  /**
   * Creates a new `SpotLight`; add it under {@link View3D.root | view.root} to light the view
   * @param options - Construction options; see {@link SpotLightOptions}.
   */
  constructor(options: SpotLightOptions = {}) {
    const { range, radius, coneAngle, penumbra, ...rest } = { ...SpotLight.defaultOptions, ...definedProps(options) };

    super({ label: 'SpotLight', ...rest });

    this.range = range!;
    this.radius = radius!;
    this.coneAngle = coneAngle!;
    this.penumbra = penumbra!;
  }
}
