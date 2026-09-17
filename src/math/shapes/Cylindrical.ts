import type { SHAPE_PRIMITIVE_3D } from '../misc/const';
import type { PointData3D } from '../vector/PointData3D';

/**
 * The `Cylindrical` object represents a 3D point in cylindrical coordinates `(radius, theta, y)`
 *
 * `radius` is the distance from the Y axis; `theta` is the azimuthal angle measured from +Z;
 * `y` is the height above the XZ plane.
 *
 * Use `Vector3.setFromCylindrical` for the inverse (Cartesian) direction.
 * @example
 * ```ts
 * const c = new Cylindrical().setFromCartesianCoords(1, 2, 0);
 * // c.radius = 1, c.theta = π/2, c.y = 2
 *
 * const p = new Vector3().setFromCylindrical(c);
 * ```
 * @see {@link Vector3#setFromCylindrical} For converting back to Cartesian
 * @see {@link Spherical} For spherical coordinates
 * @category maths
 * @standard
 */
export class Cylindrical {
  /** Distance from the Y axis */
  public radius: number;
  /** Azimuthal angle (radians) measured from +Z */
  public theta: number;
  /** Height above the XZ plane */
  public y: number;

  /**
   * The type of the object, mainly used to avoid `instanceof` checks
   * @readonly
   * @default 'cylindrical'
   */
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
   * @returns The new instance
   */
  public clone(): Cylindrical {
    return new Cylindrical().copyFrom(this);
  }

  /**
   * Returns true when `radius`, `theta` and `y` match `other` exactly (no epsilon tolerance)
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
   * @param v - The Cartesian point to convert
   * @returns This instance for chaining
   */
  public setFromPoint3D(v: PointData3D): this {
    return this.setFromCartesianCoords(v.x, v.y, v.z);
  }

  /**
   * Sets this instance from Cartesian `(x, y, z)`
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
   */
  public toString(): string {
    return `[pixi-3d/math:Cylindrical radius=${this.radius} theta=${this.theta} y=${this.y}]`;
  }
}
