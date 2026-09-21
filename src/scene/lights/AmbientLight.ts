import { definedProps } from 'pixi.js';

import { Light } from './Light';
import type { LightOptions } from './Light';

/**
 * Constructor options for {@link AmbientLight}
 *
 * Same shape as {@link LightOptions}, minus the shadow fields — ambient light
 * never casts shadows.
 * @example
 * ```ts
 * const fill = new AmbientLight({ color: 0xffffff, intensity: 0.3, label: 'fill' });
 * ```
 * @category scene
 * @standard
 */
export interface AmbientLightOptions extends Omit<LightOptions, 'castShadow' | 'shadow'> {
  /**
   * Linear intensity multiplier applied to {@link LightOptions.color | color}
   * @default 0.5
   */
  intensity?: number;
}

/**
 * Uniform fill light that adds a constant per-channel radiance to every fragment
 *
 * The contribution is independent of surface normal and position. Cheap enough
 * that you almost always want one: it lifts shadowed areas off pure black
 * without per-pixel lighting cost.
 *
 * Never casts shadows; `castShadow` is ignored.
 * @example
 * ```ts
 * import { AmbientLight } from '@pixi/3d';
 *
 * view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.3 }));
 * ```
 * @see {@link Light} For the abstract base class.
 * @see {@link Hemisphere} For a normal-aware sky/ground alternative.
 * @category scene
 * @standard
 */
export class AmbientLight extends Light {
  /**
   * Default {@link AmbientLightOptions} merged under every constructor call
   *
   * `new AmbientLight(opts)` resolves as
   * `{ ...AmbientLight.defaultOptions, ...definedProps(opts) }`. Mutate to
   * change the defaults process-wide.
   */
  public static defaultOptions: AmbientLightOptions = {
    color: 0xffffff,
    intensity: 0.5,
  };

  /** Discriminator for the ambient light kind */
  public readonly type = 'ambient';

  /**
   * Creates a new `AmbientLight`. Add it to a {@link View3D} by parenting it
   * under {@link View3D.root | view.root}.
   * @param options - construction options; see {@link AmbientLightOptions}.
   */
  constructor(options: AmbientLightOptions = {}) {
    super({ label: 'AmbientLight', ...AmbientLight.defaultOptions, ...definedProps(options) });
  }

  /** Ambient light has no direction to cast along */
  override get canCastShadow(): boolean {
    return false;
  }
}
