import { definedProps, warn } from 'pixi.js';

import { Light } from './Light';
import type { LightOptions } from './Light';

/**
 * Constructor options for {@link PointLight}: the {@link LightOptions} plus a
 * {@link PointLightOptions.range | range} and a {@link PointLightOptions.radius | radius}
 * @example
 * ```ts
 * const options: PointLightOptions = { color: 0xffd180, intensity: 8, range: 12, radius: 0.25 };
 * const lamp = new PointLight(options);
 * ```
 * @category scene
 * @standard
 */
export interface PointLightOptions extends LightOptions {
  /**
   * Distance the light reaches, in world units; see {@link PointLight.range}
   * @default 0
   * @example
   * ```ts
   * const candle = new PointLight({ intensity: 2, range: 3 });
   * ```
   */
  range?: number;
  /**
   * Radius of the light's bulb, in world units; see {@link PointLight.radius}
   * @default 0.1
   * @example
   * ```ts
   * const lantern = new PointLight({ intensity: 4, range: 6, radius: 0.6 });
   * ```
   */
  radius?: number;
}

/**
 * Light that shines equally in every direction from a point, like a bulb
 *
 * It dims with the square of the distance, fading smoothly to nothing at its
 * {@link PointLight.range | range} when it has one. Only its position matters; rotating it
 * changes nothing. Point lights cast no shadows.
 * @example
 * ```ts
 * import { PointLight } from '@pixi/3d';
 *
 * const lamp = new PointLight({ color: 0xffd180, intensity: 8, range: 12 });
 * lamp.position.set(0, 2, 0);
 * view.root.addChild(lamp);
 * ```
 * @see {@link SpotLight} For a directional cone alternative.
 * @category scene
 * @standard
 */
export class PointLight extends Light {
  /**
   * Defaults for every new `PointLight`; an option passed as `undefined` keeps its default
   * @example
   * ```ts
   * PointLight.defaultOptions.range = 10;
   * ```
   */
  public static defaultOptions: PointLightOptions = {
    color: 0xffffff,
    intensity: 1,
    range: 0,
    radius: 0.1,
  };

  /** Always `'point'` */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- read-only discriminant
  public readonly type = 'point';

  /**
   * Distance the light reaches, in world units, or `0` for no limit
   *
   * The light fades smoothly to nothing at this distance. Give lights a range when you can: one
   * without is shaded on every pixel, one with only where it reaches, which matters with many lights.
   * @default 0
   * @example
   * ```ts
   * lamp.range = 12;
   * ```
   */
  public range = 0;

  /**
   * Radius of the light's bulb, in world units
   *
   * A surface stops getting brighter once it's closer to the light than about this distance. Raise
   * it past the light's distance from a surface to soften the hot spot there: for a lantern 0.3
   * above the ground, try 0.6. Surfaces farther than about twice the radius barely change. Values
   * under 0.01 act as 0.01.
   * @default 0.1
   * @example
   * ```ts
   * lamp.radius = 0.6;
   * ```
   */
  public radius = 0.1;

  /**
   * Creates a new `PointLight`; add it under {@link View3D.root | view.root} to light the view
   *
   * Warns when `castShadow` is `true`, since point lights cast no shadows.
   * @param options - Construction options; see {@link PointLightOptions}.
   */
  constructor(options: PointLightOptions = {}) {
    const { range, radius, ...rest } = { ...PointLight.defaultOptions, ...definedProps(options) };

    super({ label: 'PointLight', ...rest });

    this.range = range!;
    this.radius = radius!;

    if (this.castShadow) {
      warn('PointLight does not cast shadows; `castShadow` has no effect.');
    }
  }

  /**
   * Always `false`: point lights cast no shadows
   * @advanced
   */
  override get canCastShadow(): boolean {
    return false;
  }
}
