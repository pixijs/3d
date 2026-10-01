/**
 * Minimal `{ x, y, z, w }` shape that 4D math methods accept
 *
 * Any plain object with these four numbers can be passed in place of a full {@link Vector4}.
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
  /**
   * Position of the point on the x axis
   * @example
   * ```ts
   * const clip = new Vector4(point.x, point.y, point.z, 1).applyMatrix4(camera.viewProjection);
   * const screenX = clip.x / clip.w;
   * ```
   */
  x: number;
  /**
   * Position of the point on the y axis
   * @example
   * ```ts
   * const screenY = clip.y / clip.w;
   * ```
   */
  y: number;
  /**
   * Position of the point on the z axis
   * @example
   * ```ts
   * const depth = clip.z / clip.w;
   * ```
   */
  z: number;
  /**
   * Fourth component, `1` for a position and `0` for a direction by convention
   *
   * A 4x4 matrix moves a point whose `w` is 1, and only turns one whose `w` is 0.
   * @example
   * ```ts
   * const behindCamera = clip.w <= 0;
   * ```
   */
  w: number;
}
