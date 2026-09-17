import { definedProps } from 'pixi.js';

import { Light } from './Light';
import type { LightOptions } from './Light';

/**
 * Constructor options for {@link DirectionalLight}
 *
 * Same shape as {@link LightOptions}.
 * @example
 * ```ts
 * const sun = new DirectionalLight({ intensity: 3, castShadow: true, shadow: { cascades: 3 } });
 * ```
 * @category scene
 * @standard
 */
export interface DirectionalLightOptions extends LightOptions {} // oxlint-disable-line no-empty-object-type

/**
 * Parallel-ray light that lights every fragment from the same direction
 *
 * Position-independent shading — the sun is the canonical example. Cheap to
 * evaluate (one dot product per pixel), so it's the default recommendation for
 * the scene's key light.
 *
 * The light's direction is its local **-Z** axis transformed by its world
 * matrix. Position is ignored for shading (parallel rays have no origin) but
 * matters for shadow-frustum framing — keep the light at a sensible distance
 * from your scene origin and aim it with {@link Container3D.lookAt | lookAt}.
 *
 * Supports cascaded shadow maps (CSM) via {@link LightShadow.cascades} for
 * large scenes where one shadow frustum can't resolve both near and far
 * geometry.
 * @example
 * ```ts
 * import { DirectionalLight } from '@pixi/3d';
 *
 * const sun = new DirectionalLight({
 *   color: 0xfff4e0,
 *   intensity: 3,
 *   castShadow: true,
 *   shadow: { cascades: 3, maxDistance: 25, lambda: 0.6 },
 * });
 * sun.position.set(10, 15, 5);
 * sun.lookAt({ x: 0, y: 0, z: 0 }); // local -Z faces origin
 * view.root.addChild(sun);
 * ```
 * @see {@link Light} For the abstract base class.
 * @see {@link LightShadow} For shadow tuning fields (bounds, cascades, update, bias).
 * @category scene
 * @standard
 */
export class DirectionalLight extends Light {
  /**
   * Default {@link DirectionalLightOptions} merged under every constructor call
   *
   * `new DirectionalLight(opts)` resolves as
   * `{ ...DirectionalLight.defaultOptions, ...definedProps(opts) }`. Mutate
   * to change the defaults process-wide.
   */
  public static defaultOptions: DirectionalLightOptions = {
    color: 0xffffff,
    intensity: 1,
    castShadow: false,
  };

  /** Discriminator for the directional light kind */
  public readonly type = 'directional';

  /**
   * Creates a new `DirectionalLight`. Add it to a {@link View3D} by
   * parenting it under {@link View3D.root | view.root}.
   * @param options - construction options; see {@link DirectionalLightOptions}.
   */
  constructor(options: DirectionalLightOptions = {}) {
    super({ label: 'DirectionalLight', ...DirectionalLight.defaultOptions, ...definedProps(options) });
  }
}
