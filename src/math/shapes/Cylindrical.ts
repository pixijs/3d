import type { SHAPE_PRIMITIVE_3D } from '../misc/const';
import type { PointData3D } from '../vector/PointData3D';

/**
 * A point given as `radius`, `theta` and `y`: its distance from the Y axis, its angle around that
 * axis measured from +Z toward +X, and its height
 *
 * Use it to lay things out around a vertical axis, such as a ring of pillars or a spiral staircase,
 * then convert back with {@link Vector3#setFromCylindrical}.
 * @example
 * ```ts
 * const step = new Cylindrical();
 *
 * for (let i = 0; i < stairs.length; i++) {
 *   step.set(4, i * 0.4, i * 0.25);
 *   stairs[i].position.setFromCylindrical(step);
 * }
 * ```
 * @see {@link Vector3#setFromCylindrical} For converting back to Cartesian
 * @see {@link Spherical} For spherical coordinates
 * @category maths
 * @standard
 */
export class Cylindrical {
  /**
   * Distance from the Y axis
   * @example
   * ```ts
   * ring.radius = arenaRadius - 1;
   * ```
   */
  public radius = 0;
  /**
   * Angle in radians around the Y axis, measured from +Z toward +X
   * @example
   * ```ts
   * carousel.theta += ticker.deltaMS * 0.001;
   * ```
   */
  public theta = 0;
  /**
   * Height above the XZ plane
   * @example
   * ```ts
   * spiral.y += climbSpeed;
   * ```
   */
  public y = 0;

  /**
   * Names the shape without an `instanceof` check, like the `type` on pixi's 2D shapes
   * @readonly
   * @default 'cylindrical'
   */
  // oxlint-disable-next-line pixi3d/require-standard-example -- read-only discriminant
  public readonly type: SHAPE_PRIMITIVE_3D = 'cylindrical';

  /**
   * Creates a new `Cylindrical`
   * @param radius - Distance from the Y axis
   * @param theta - Azimuthal angle (radians) measured from +Z
   * @param y - Height above the XZ plane
   */
  constructor(radius = 1, theta = 0, y = 0) {
    this.radius = radius;
    this.theta = theta;
    this.y = y;
  }

  /**
   * Sets `radius`, `theta` and `y`
   * @example
   * ```ts
   * const slot = new Cylindrical().set(6, (index / count) * Math.PI * 2, 0);
   * ```
   * @param radius - Distance from the Y axis
   * @param theta - Azimuthal angle (radians) measured from +Z
   * @param y - Height above the XZ plane
   * @returns This instance for chaining
   */
  public set(radius: number, theta: number, y: number): this {
    this.radius = radius;
    this.theta = theta;
    this.y = y;

    return this;
  }

  /**
   * Copies `other` into this instance
   * @example
   * ```ts
   * restingSlot.copyFrom(slot);
   * ```
   * @param other - The coordinates to copy from
   * @returns This instance for chaining
   */
  public copyFrom(other: Cylindrical): this {
    this.radius = other.radius;
    this.theta = other.theta;
    this.y = other.y;

    return this;
  }

  /**
   * Copies this instance into `target` and returns it
   * @example
   * ```ts
   * slot.copyTo(restingSlot);
   * ```
   * @param target - The instance to copy into
   * @returns The given `target`
   */
  public copyTo<T extends Cylindrical>(target: T): T {
    target.radius = this.radius;
    target.theta = this.theta;
    target.y = this.y;

    return target;
  }

  /**
   * Creates a new `Cylindrical` with the same values
   * @example
   * ```ts
   * const start = slot.clone();
   * ```
   * @returns The new instance
   */
  public clone(): Cylindrical {
    return new Cylindrical().copyFrom(this);
  }

  /**
   * Returns true when `radius`, `theta` and `y` match `other` exactly (no epsilon tolerance)
   * @example
   * ```ts
   * const settled = slot.equals(restingSlot);
   * ```
   * @param other - The coordinates to compare with
   * @returns Whether all components match
   */
  public equals(other: Cylindrical): boolean {
    return other.radius === this.radius && other.theta === this.theta && other.y === this.y;
  }

  /**
   * Sets this instance from the Cartesian point `v`
   *
   * Equivalent to `setFromCartesianCoords(v.x, v.y, v.z)`.
   * @example
   * ```ts
   * const around = new Cylindrical().setFromPoint3D(player.position);
   * ```
   * @param v - The Cartesian point to convert
   * @returns This instance for chaining
   */
  public setFromPoint3D(v: PointData3D): this {
    return this.setFromCartesianCoords(v.x, v.y, v.z);
  }

  /**
   * Sets this instance from Cartesian `(x, y, z)`
   * @example
   * ```ts
   * const around = new Cylindrical().setFromCartesianCoords(pointer.x, 0, pointer.z);
   * ```
   * @param x - The Cartesian x coordinate
   * @param y - The Cartesian y coordinate
   * @param z - The Cartesian z coordinate
   * @returns This instance for chaining
   */
  public setFromCartesianCoords(x: number, y: number, z: number): this {
    this.radius = Math.sqrt(x * x + z * z);
    this.theta = Math.atan2(x, z);
    this.y = y;

    return this;
  }

  /**
   * Returns a string representation of these coordinates
   * @returns A string in the form `[pixi-3d/math:Cylindrical radius=1 theta=0 y=0]`
   * @advanced
   */
  public toString(): string {
    return `[pixi-3d/math:Cylindrical radius=${this.radius} theta=${this.theta} y=${this.y}]`;
  }
}
