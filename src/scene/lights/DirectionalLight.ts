import { definedProps } from 'pixi.js';

import { Light } from './Light';
import type { LightOptions } from './Light';

/**
 * Constructor options for {@link DirectionalLight}, the same as {@link LightOptions}
 * @example
 * ```ts
 * const sun = new DirectionalLight({ intensity: 3, castShadow: true, shadow: { cascades: 3 } });
 * ```
 * @category scene
 * @standard
 */
export interface DirectionalLightOptions extends LightOptions {}

/**
 * Light that arrives from one direction everywhere in the scene, like the sun
 *
 * The usual choice for a scene's main light.
 *
 * It shines along its local **-Z** axis, so only its rotation matters: moving it doesn't change
 * the lighting, and its shadow is fitted to the scene or to the camera wherever it sits. Aim it
 * with {@link Container3D.lookAt | lookAt} from any position.
 *
 * Its shadow covers one box over the scene by default. For a large world, turn on
 * {@link LightShadow.cascades | cascades}, which keep shadows near the camera sharp.
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
 * @see {@link LightShadow} For shadow tuning fields (bounds, cascades, update, bias).
 * @category scene
 * @standard
 */
export class DirectionalLight extends Light {
  /**
   * Defaults for every new `DirectionalLight`; an option passed as `undefined` keeps its default
   * @example
   * ```ts
   * DirectionalLight.defaultOptions.castShadow = true;
   * ```
   */
  public static defaultOptions: DirectionalLightOptions = {
    color: 0xffffff,
    intensity: 1,
    castShadow: false,
  };

  /** Always `'directional'` */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- read-only discriminant
  public readonly type = 'directional';

  /**
   * Creates a new `DirectionalLight`; add it under {@link View3D.root | view.root} to light the view
   * @param options - Construction options; see {@link DirectionalLightOptions}.
   */
  constructor(options: DirectionalLightOptions = {}) {
    super({ label: 'DirectionalLight', ...DirectionalLight.defaultOptions, ...definedProps(options) });
  }
}
