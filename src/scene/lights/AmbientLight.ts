import { definedProps } from 'pixi.js';

import { Light } from './Light';
import type { LightOptions } from './Light';

/**
 * Constructor options for {@link AmbientLight}
 *
 * The {@link LightOptions} without the shadow fields: ambient light casts no shadows.
 * @example
 * ```ts
 * const fill = new AmbientLight({ color: 0xffffff, intensity: 0.3, label: 'fill' });
 * ```
 * @category scene
 * @standard
 */
export interface AmbientLightOptions extends Omit<LightOptions, 'castShadow' | 'shadow'> {
  /**
   * Brightness; see {@link Light.intensity}
   * @default 0.5
   * @example
   * ```ts
   * const fill = new AmbientLight({ intensity: 0.2 });
   * ```
   */
  intensity?: number;
}

/**
 * Light that reaches every surface equally, whatever its position or direction
 *
 * It lifts shadowed areas off pure black for almost no cost. Several ambient lights add up.
 * It casts no shadows; `castShadow` is ignored.
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
   * `new AmbientLight(opts)` resolves as `{ ...AmbientLight.defaultOptions, ...opts }`, ignoring
   * options set to `undefined`. Mutate to change the defaults process-wide.
   * @example
   * ```ts
   * AmbientLight.defaultOptions.intensity = 0.2;
   * ```
   */
  public static defaultOptions: AmbientLightOptions = {
    color: 0xffffff,
    intensity: 0.5,
  };

  /** Always `'ambient'` */
  // oxlint-disable-next-line pixi3d/require-standard-example -- read-only discriminant
  public readonly type = 'ambient';

  /**
   * Creates a new `AmbientLight`; add it under {@link View3D.root | view.root} to light the view
   * @param options - Construction options; see {@link AmbientLightOptions}.
   */
  constructor(options: AmbientLightOptions = {}) {
    super({ label: 'AmbientLight', ...AmbientLight.defaultOptions, ...definedProps(options) });
  }

  /**
   * Always `false`: ambient light has no direction to cast along
   * @advanced
   */
  override get canCastShadow(): boolean {
    return false;
  }
}
