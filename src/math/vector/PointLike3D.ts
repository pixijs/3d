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
 * @category maths
 * @standard
 */
export interface PointLike3D extends PointData3D {
  /**
   * Sets the x, y and z components
   * @example
   * ```ts
   * node.position.set(0, 2, 0);
   * node.scale.set(2);
   * ```
   * @param x - The x component
   * @param y - The y component, defaults to `x`
   * @param z - The z component, defaults to `x`
   */
  set: (x?: number, y?: number, z?: number) => this;
  /**
   * Copies `x`, `y` and `z` from `p`
   * @example
   * ```ts
   * pickup.position.copyFrom({ x: 0, y: 1, z: -4 });
   * ```
   * @param p - The point to copy from
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
   * Checks whether `x`, `y` and `z` all match `p` exactly, with no tolerance
   * @example
   * ```ts
   * if (!player.position.equals(lastSentPosition)) sendPosition(player.position);
   * ```
   * @param p - The point to compare against
   */
  equals: (p: PointData3D) => boolean;
}
