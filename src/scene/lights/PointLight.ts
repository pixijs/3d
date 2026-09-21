import { definedProps, warn } from 'pixi.js';

import { Light } from './Light';
import type { LightOptions } from './Light';

/**
 * Constructor options for {@link PointLight}
 *
 * Adds {@link PointLightOptions.range | range} on top of the shared
 * {@link LightOptions} fields.
 * @category scene
 * @standard
 */
export interface PointLightOptions extends LightOptions {
  /**
   * Maximum distance (in world units) over which this light contributes
   *
   * `0` means infinite range (no falloff distance cutoff — only the inverse
   * square falloff applies).
   * @default 0
   */
  range?: number;
}

/**
 * Omnidirectional point emitter radiating equally in every direction from its
 * world-space position
 *
 * Intensity falls off with inverse-square law, smoothly windowed to zero at
 * {@link PointLight.range} when range is non-zero.
 *
 * Direction (and `lookAt`) is irrelevant for shading — only world-space
 * position matters. Point lights do not currently cast shadows.
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
   * `new PointLight(opts)` resolves as
   * `{ ...PointLight.defaultOptions, ...definedProps(opts) }`. Mutate to
   * change the defaults process-wide.
   */
  public static defaultOptions: PointLightOptions = {
    color: 0xffffff,
    intensity: 1,
    range: 0,
  };

  /** Discriminator for the point light kind */
  public readonly type = 'point';

  /**
   * Maximum distance (in world units) over which this light contributes
   *
   * `0` disables the distance cutoff so only inverse-square falloff applies.
   * Mutate freely for a free per-frame update.
   * @default 0
   */
  public range: number;

  /**
   * Creates a new `PointLight`. Add it to a {@link View3D} by parenting it
   * under {@link View3D.root | view.root}.
   * @param options - construction options; see {@link PointLightOptions}.
   */
  constructor(options: PointLightOptions = {}) {
    const { range, ...rest } = { ...PointLight.defaultOptions, ...definedProps(options) };

    super({ label: 'PointLight', ...rest });

    this.range = range!;

    if (this.castShadow) {
      warn('PointLight does not cast shadows; `castShadow` has no effect.');
    }
  }

  /** Point lights never cast */
  override get canCastShadow(): boolean {
    return false;
  }
}
