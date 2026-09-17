import type { PointData4D } from './PointData4D';

/**
 * Common interface for 4D points with manipulation methods
 *
 * Extends {@link PointData4D} to add operations for copying, comparison and setting values. By
 * convention `w` is `1` for positions and `0` for direction vectors.
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
   * If `y` or `z` is omitted, both default to `x`. `w` defaults to `1` to match the
   * homogeneous-coord position convention.
   * @param x - Position of the point on the x axis
   * @param y - Position of the point on the y axis, defaults to `x`
   * @param z - Position of the point on the z axis, defaults to `x`
   * @param w - Homogeneous coordinate, defaults to `1`
   * @returns The point instance itself
   */
  set: (x?: number, y?: number, z?: number, w?: number) => this;
  /**
   * Copies x, y, z, w from the given point into this point
   * @param p - The point to copy from
   * @returns The point instance itself
   */
  copyFrom: (p: PointData4D) => this;
  /**
   * Copies this point's x, y, z, w into the given point
   * @param p - The point to copy into
   * @returns The given point with values updated
   */
  copyTo: <T extends PointLike4D>(p: T) => T;
  /**
   * Checks if another point is equal to this point
   * @param p - The point to check
   * @returns `true` if all of `x`, `y`, `z` and `w` are equal
   */
  equals: (p: PointData4D) => boolean;
}
