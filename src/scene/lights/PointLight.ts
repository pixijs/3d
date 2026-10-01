import { definedProps, warn } from 'pixi.js';

import { Light } from './Light';
import type { LightOptions } from './Light';

/**
 * Constructor options for {@link PointLight}: the {@link LightOptions} plus a
 * {@link PointLightOptions.range | range}
 * @example
 * ```ts
 * const options: PointLightOptions = { color: 0xffd180, intensity: 8, range: 12 };
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
 * @see {@link Light} For the abstract base class.
 * @see {@link SpotLight} For a directional cone alternative.
 * @category scene
 * @standard
 */
export class PointLight extends Light {
  /**
   * Default {@link PointLightOptions} merged under every constructor call
   *
   * `new PointLight(opts)` resolves as `{ ...PointLight.defaultOptions, ...opts }`, ignoring
   * options set to `undefined`. Mutate to change the defaults process-wide.
   * @example
   * ```ts
   * PointLight.defaultOptions.range = 10;
   * ```
   */
  public static defaultOptions: PointLightOptions = {
    color: 0xffffff,
    intensity: 1,
    range: 0,
  };

  /** Always `'point'` */
  // oxlint-disable-next-line pixi3d/require-standard-example -- read-only discriminant
  public readonly type = 'point';

  /**
   * Distance the light reaches, in world units, or `0` for no limit
   *
   * The light fades smoothly to nothing at this distance. Without a range it never quite reaches
   * zero, so the view shades it on every pixel. Give lights a range when you can: the view then
   * shades each one only where it reaches, which matters with many lights. Change it at any time.
   * @default 0
   * @example
   * ```ts
   * lamp.range = 12;
   * ```
   */
  public range = 0;

  /**
   * Creates a new `PointLight`; add it under {@link View3D.root | view.root} to light the view
   *
   * Warns when `castShadow` is `true`, since point lights cast no shadows.
   * @param options - Construction options; see {@link PointLightOptions}.
   */
  constructor(options: PointLightOptions = {}) {
    const { range, ...rest } = { ...PointLight.defaultOptions, ...definedProps(options) };

    super({ label: 'PointLight', ...rest });

    this.range = range!;

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
