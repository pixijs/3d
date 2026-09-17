import type { PointData3D } from './PointData3D';

/**
 * Minimal write-capable 3D point interface
 *
 * Extends {@link PointData3D} with the four lifecycle methods (`set`, `copyFrom`, `copyTo`,
 * `equals`) shared by both {@link Vector3} and {@link ObservableVector3}, so callers can accept
 * either implementation.
 * @see {@link PointData3D} For the read-only `{ x, y, z }` shape
 * @see {@link Vector3} For the standard implementation
 * @see {@link ObservableVector3} For the observable implementation
 * @category maths
 * @standard
 */
export interface PointLike3D extends PointData3D {
  /**
   * Sets the point to a new x, y and z position
   * @param x - Position of the point on the x axis
   * @param y - Position of the point on the y axis, defaults to `x`
   * @param z - Position of the point on the z axis, defaults to `x`
   * @returns The point instance itself
   */
  set: (x?: number, y?: number, z?: number) => this;
  /**
   * Copies `x`, `y`, `z` from `p` into this point
   * @param p - The point to copy from
   * @returns The point instance itself
   */
  copyFrom: (p: PointData3D) => this;
  /**
   * Writes this point's `x`, `y`, `z` into `p`
   * @param p - The point to copy into
   * @returns The given point with values updated
   */
  copyTo: <T extends PointLike3D>(p: T) => T;
  /**
   * Checks if another point is equal to this point
   * @param p - The point to check
   * @returns `true` when `x`, `y` and `z` match `p` exactly (no epsilon tolerance)
   */
  equals: (p: PointData3D) => boolean;
}
