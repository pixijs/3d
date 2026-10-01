import type { PointData3D } from './PointData3D';

/**
 * A {@link PointData3D} you can also set, copy and compare
 *
 * {@link Vector3}, {@link ObservableVector3} and a node's {@link Container3D#angle | angle} all
 * implement it, so a function that takes one accepts any of them.
 * @example
 * ```ts
 * function dropToGround(point: PointLike3D): void {
 *   point.set(point.x, 0, point.z);
 * }
 *
 * dropToGround(crate.position);
 * dropToGround(new Vector3(3, 5, 1));
 * ```
 * @see {@link PointData3D} For the read-only `{ x, y, z }` shape
 * @see {@link Vector3} For the standard implementation
 * @see {@link ObservableVector3} For the observable implementation
 * @category maths
 * @standard
 */
export interface PointLike3D extends PointData3D {
  /**
   * Sets the point to a new x, y and z position
   * @example
   * ```ts
   * node.position.set(0, 2, 0);
   * node.scale.set(2);
   * ```
   * @param x - Position of the point on the x axis
   * @param y - Position of the point on the y axis, defaults to `x`
   * @param z - Position of the point on the z axis, defaults to `x`
   * @returns The point instance itself
   */
  set: (x?: number, y?: number, z?: number) => this;
  /**
   * Copies `x`, `y`, `z` from `p` into this point
   * @example
   * ```ts
   * pickup.position.copyFrom({ x: 0, y: 1, z: -4 });
   * ```
   * @param p - The point to copy from
   * @returns The point instance itself
   */
  copyFrom: (p: PointData3D) => this;
  /**
   * Writes this point's `x`, `y`, `z` into `p`
   * @example
   * ```ts
   * player.position.copyTo(lastCheckpoint);
   * ```
   * @param p - The point to copy into
   * @returns The given point with values updated
   */
  copyTo: <T extends PointLike3D>(p: T) => T;
  /**
   * Checks if another point is equal to this point
   * @example
   * ```ts
   * if (!player.position.equals(lastSentPosition)) sendPosition(player.position);
   * ```
   * @param p - The point to check
   * @returns `true` when `x`, `y` and `z` match `p` exactly (no epsilon tolerance)
   */
  equals: (p: PointData3D) => boolean;
}
