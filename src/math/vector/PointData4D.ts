/**
 * Common interface for 4D points (homogeneous-coord positions or generic four-component vectors)
 *
 * Provides a structural way to represent 4D coordinates. Implemented by {@link Vector4} and any
 * compatible type with `x`, `y`, `z` and `w` properties. By convention `w` is `1` for positions and
 * `0` for direction vectors.
 * @example
 * ```ts
 * const p: PointData4D = { x: 1, y: 2, z: 3, w: 1 };
 *
 * const v4 = new Vector4();
 * v4.copyFrom(p);
 * ```
 * @see {@link Vector4} For standard 4D vector implementation
 * @see {@link PointLike4D} For 4D point manipulation interface
 * @category maths
 * @standard
 */
export interface PointData4D {
  /** Position of the point on the x axis */
  x: number;
  /** Position of the point on the y axis */
  y: number;
  /** Position of the point on the z axis */
  z: number;
  /** Homogeneous coordinate; `1` for positions and `0` for direction vectors by convention */
  w: number;
}
