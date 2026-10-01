import type { ColorSource } from 'pixi.js';

import type { PointData3D } from '../../../math/vector/PointData3D';

/**
 * World-up `(0, 1, 0)`, the default for {@link Hemisphere.up}
 * @internal
 */
export const HEMISPHERE_DEFAULT_UP = { x: 0, y: 1, z: 0 } as const;

/**
 * Sky and ground colours that light the scene in place of an environment map, or fill the
 * background behind it
 *
 * Assign one to {@link View3D.environment}. A surface facing `up` takes the sky colour, one facing
 * the other way takes the ground colour, and anything between blends the two:
 * `mix(groundColor, skyColor, dot(normal, up) * 0.5 + 0.5) * intensity`. Reflections read the
 * same gradient, so a white hemisphere lights a surface the same as an all-white cube map.
 *
 * It costs a few instructions per pixel and no texture reads, so it suits mobile, where sampling
 * a cube map costs more. It casts no shadows.
 *
 * Assigned to {@link View3D#background}, it draws the same gradient behind the scene, with the
 * view direction in place of the normal. Use one object for both and the sky matches the light
 * the scene receives.
 *
 * It's a plain object, not a class: pass an object literal. The view reads its fields every
 * frame and only parses a colour that changed, so changing one is a property write, cheap enough
 * for a sunset or a biome transition.
 * @example
 * ```ts
 * new View3D({
 *   width,
 *   height,
 *   environment: { skyColor: 0x88ccff, groundColor: 0x553311 },
 * });
 *
 * // Change a colour at any time:
 * (view.environment as Hemisphere).skyColor = 0xff8800; // sunset
 *
 * // The same object as a procedural sky behind the scene
 * const sky: Hemisphere = { skyColor: 0x88ccff, groundColor: 0x553311 };
 * new View3D({ width, height, environment: sky, background: sky });
 * ```
 * @category environment
 * @standard
 */
export interface Hemisphere {
  /**
   * Colour in the direction of `up`: what a surface facing `up` receives, and the sky drawn there
   * as a background
   * @example
   * ```ts
   * hemisphere.skyColor = 0x88ccff;
   * ```
   */
  skyColor: ColorSource;
  /**
   * Colour in the direction opposite `up`: what a surface facing away from `up` receives
   * @example
   * ```ts
   * hemisphere.groundColor = 0x553311;
   * ```
   */
  groundColor: ColorSource;
  /**
   * Direction the sky is in; it doesn't need to be normalised
   * @default { x: 0, y: 1, z: 0 }
   * @example
   * ```ts
   * const zUpWorld: Hemisphere = { skyColor: 0x88ccff, groundColor: 0x553311, up: { x: 0, y: 0, z: 1 } };
   * ```
   */
  up?: PointData3D;
  /**
   * Brightness, multiplied into both colours, as a light and as a background
   * @default 1
   * @example
   * ```ts
   * hemisphere.intensity = isNight ? 0.2 : 1;
   * ```
   */
  intensity?: number;
}
