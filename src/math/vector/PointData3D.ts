import type { PointData } from 'pixi.js';

/**
 * Minimal `{ x, y, z }` shape that 3D math methods accept
 *
 * Any plain object with these three numbers can be passed in place of a {@link Vector3}.
 * @example
 * ```ts
 * const spawnPoint: PointData3D = { x: 0, y: 1, z: -5 };
 *
 * enemy.position.copyFrom(spawnPoint);
 * ```
 * @category maths
 * @standard
 */
export interface PointData3D extends PointData {
  /**
   * Position on the z axis
   * @example
   * ```ts
   * waypoints.sort((a: PointData3D, b: PointData3D) => a.z - b.z);
   * ```
   */
  z: number;
}
