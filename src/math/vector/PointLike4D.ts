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
 * @category maths
 * @standard
 */
export interface PointLike4D extends PointData4D {
  /**
   * Sets all four components
   * @example
   * ```ts
   * point.set(0, 2, 0);
   * direction.set(0, 0, -1, 0);
   * ```
   * @param x - The x component
   * @param y - The y component, defaults to `x`
   * @param z - The z component, defaults to `x`
   * @param w - The fourth component, defaults to `1`, not to `x`
   */
  set: (x?: number, y?: number, z?: number, w?: number) => this;
  /**
   * Copies `x`, `y`, `z` and `w` from `p`
   * @example
   * ```ts
   * point.copyFrom({ x: 0, y: 1, z: 0, w: 1 });
   * ```
   * @param p - The point to copy from
   */
  copyFrom: (p: PointData4D) => this;
  /**
   * Writes this point's `x`, `y`, `z` and `w` into `p`
   * @example
   * ```ts
   * point.copyTo(previousPoint);
   * ```
   * @param p - The point to copy into
   * @returns The given point with values updated
   */
  copyTo: <T extends PointLike4D>(p: T) => T;
  /**
   * Checks whether `x`, `y`, `z` and `w` all match `p` exactly, with no tolerance
   * @example
   * ```ts
   * const unchanged = point.equals(previousPoint);
   * ```
   * @param p - The point to compare against
   */
  equals: (p: PointData4D) => boolean;
}
