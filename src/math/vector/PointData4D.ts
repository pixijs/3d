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
 * @category maths
 * @standard
 */
export interface PointData4D {
  /**
   * The x component
   * @example
   * ```ts
   * const clip = new Vector4(point.x, point.y, point.z, 1).applyMatrix4(camera.viewProjection);
   * const screenX = clip.x / clip.w;
   * ```
   */
  x: number;
  /**
   * The y component
   * @example
   * ```ts
   * const screenY = clip.y / clip.w;
   * ```
   */
  y: number;
  /**
   * The z component
   * @example
   * ```ts
   * const depth = clip.z / clip.w;
   * ```
   */
  z: number;
  /**
   * Fourth component, by convention `1` for a position and `0` for a direction
   * @example
   * ```ts
   * const behindCamera = clip.w <= 0;
   * ```
   */
  w: number;
}
