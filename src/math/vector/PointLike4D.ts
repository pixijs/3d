import type { PointData4D } from './PointData4D';

/**
 * A {@link PointData4D} you can also set, copy and compare
 * @example
 * ```ts
 * const point: PointLike4D = new Vector4(10, 20, 30, 1);
 * point.set(40, 50, 60, 1);
 *
 * const other = new Vector4();
 * point.copyTo(other);
 *
 * const same = point.equals(other); // true
 * ```
 * @see {@link PointData4D} For basic x,y,z,w interface
 * @see {@link Vector4} For standard implementation
 * @category maths
 * @standard
 */
export interface PointLike4D extends PointData4D {
  /**
   * Sets the point to a new x, y, z and w position
   *
   * `y` and `z` default to `x`, and `w` defaults to `1`, the value for a position.
   * @example
   * ```ts
   * point.set(0, 2, 0);
   * direction.set(0, 0, -1, 0);
   * ```
   * @param x - Position of the point on the x axis
   * @param y - Position of the point on the y axis, defaults to `x`
   * @param z - Position of the point on the z axis, defaults to `x`
   * @param w - Fourth component, defaults to `1`
   * @returns The point instance itself
   */
  set: (x?: number, y?: number, z?: number, w?: number) => this;
  /**
   * Copies x, y, z, w from the given point into this point
   * @example
   * ```ts
   * point.copyFrom({ x: 0, y: 1, z: 0, w: 1 });
   * ```
   * @param p - The point to copy from
   * @returns The point instance itself
   */
  copyFrom: (p: PointData4D) => this;
  /**
   * Copies this point's x, y, z, w into the given point
   * @example
   * ```ts
   * point.copyTo(previousPoint);
   * ```
   * @param p - The point to copy into
   * @returns The given point with values updated
   */
  copyTo: <T extends PointLike4D>(p: T) => T;
  /**
   * Checks if another point is equal to this point
   * @example
   * ```ts
   * const unchanged = point.equals(previousPoint);
   * ```
   * @param p - The point to check
   * @returns `true` if all of `x`, `y`, `z` and `w` are equal
   */
  equals: (p: PointData4D) => boolean;
}
