import type { ColorSource } from 'pixi.js';

/**
 * World-up `(0, 1, 0)` — default axis for {@link Hemisphere.up}
 * @internal
 */
export const HEMISPHERE_DEFAULT_UP = { x: 0, y: 1, z: 0 } as const;

/**
 * Sky/ground fill light
 *
 * Evaluated per fragment as
 * `mix(groundColor, skyColor, dot(normal, up) * 0.5 + 0.5) * intensity`.
 *
 * Assigned to `view3d.environment` as the alternative to an IBL cubemap.
 * A cheap, energy-consistent environment fill — no textures, pure ALU —
 * preferred on mobile where cubemap bandwidth is felt. Never casts shadows.
 *
 * Plain interface, not a class — pass an object literal and the renderer
 * reads its fields each frame.
 *
 * Colors accept any `ColorSource` (hex, CSS string, `Color`, `[r,g,b]`,
 * `{r,g,b}`) and are parsed at upload time through a shared `Color`
 * scratch — no per-assignment or per-frame allocation. Cheap to set
 * mid-frame for sunset/biome transitions.
 * @example
 * ```ts
 * new View3D({
 *   width,
 *   height,
 *   environment: { skyColor: 0x88ccff, groundColor: 0x553311 },
 * });
 *
 * // Mutation is a normal property write — the renderer re-reads each frame:
 * (view.environment as Hemisphere).skyColor = 0xff8800; // sunset
 * ```
 * @category environment
 * @standard
 */
export interface Hemisphere {
  /** Color contributing when the surface normal points along `up` */
  skyColor: ColorSource;
  /** Color contributing when the surface normal points opposite `up` */
  groundColor: ColorSource;
  /**
   * Hemisphere axis, normalised at upload time
   * @default { x: 0, y: 1, z: 0 }
   */
  up?: {
    /** X component of the axis */
    x: number;
    /** Y component of the axis */
    y: number;
    /** Z component of the axis */
    z: number;
  };
  /**
   * Multiplier applied to both sky and ground colors
   *
   * Energy-consistent with the IBL cubemap path: a `(1,1,1)` hemisphere
   * produces the same substrate diffuse contribution as an all-white IBL
   * cubemap of the same intensity.
   * @default 1
   */
  intensity?: number;
}
