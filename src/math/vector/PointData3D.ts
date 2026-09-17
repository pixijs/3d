import type { PointData } from 'pixi.js';

/**
 * Minimal `{ x, y, z }` shape consumed by 3D math methods
 *
 * Extends pixi.js `PointData` (`x`, `y`) with a `z` component, so any plain object with these three
 * numbers can be passed in place of a full {@link Vector3} or {@link ObservableVector3}.
 * @see {@link Vector3} For standard 3D vector implementation
 * @see {@link ObservableVector3} For observable 3D vector implementation
 * @see {@link PointLike3D} For the manipulation interface
 * @category maths
 * @standard
 */
export interface PointData3D extends PointData {
  /** Position on the z axis */
  z: number;
}
