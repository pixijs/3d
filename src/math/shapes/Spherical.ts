import type { SHAPE_PRIMITIVE_3D } from '../misc/const';
import { clamp } from '../utils/clamp';
import type { PointData3D } from '../vector/PointData3D';

/**
 * The `Spherical` object represents a 3D point in spherical coordinates `(radius, phi, theta)`
 *
 * `phi` is the polar angle measured from +Y; `theta` is the azimuthal angle measured from +Z.
 * Use {@link Vector3#setFromSpherical} for the inverse (Cartesian) direction.
 * @example
 * ```ts
 * const s = new Spherical().setFromCartesianCoords(0, 1, 0);
 * // s.radius = 1, s.phi = 0, s.theta = 0
 *
 * const p = new Vector3().setFromSpherical(s);
 * ```
 * @see {@link Vector3#setFromSpherical} For converting back to Cartesian
 * @see {@link Cylindrical} For cylindrical coordinates
 * @category maths
 * @standard
 */
export class Spherical {
  /** Radius (distance from origin) */
  public radius: number;
  /** Polar angle (radians) measured from +Y */
  public phi: number;
  /** Azimuthal angle (radians) measured from +Z */
  public theta: number;

  /**
   * The type of the object, mainly used to avoid `instanceof` checks
   * @readonly
   * @default 'spherical'
   */
  public readonly type: SHAPE_PRIMITIVE_3D = 'spherical';

  /**
   * Creates a new `Spherical`
   * @param radius - Distance from origin
   * @param phi - Polar angle (radians) measured from +Y
   * @param theta - Azimuthal angle (radians) measured from +Z
   */
  constructor(radius = 1, phi = 0, theta = 0) {
    this.radius = radius;
    this.phi = phi;
    this.theta = theta;
  }

  /**
   * Sets `radius`, `phi` and `theta`
   * @param radius - Distance from origin
   * @param phi - Polar angle (radians) measured from +Y
   * @param theta - Azimuthal angle (radians) measured from +Z
   * @returns This spherical, for chaining
   */
  public set(radius: number, phi: number, theta: number): this {
    this.radius = radius;
    this.phi = phi;
    this.theta = theta;

    return this;
  }

  /**
   * Copies `other` into this spherical
   * @param other - The spherical to copy from
   * @returns This spherical, for chaining
   */
  public copyFrom(other: Spherical): this {
    this.radius = other.radius;
    this.phi = other.phi;
    this.theta = other.theta;

    return this;
  }

  /**
   * Copies this spherical into `target`
   * @param target - The spherical to copy into
   * @returns The target with values updated
   */
  public copyTo<T extends Spherical>(target: T): T {
    target.radius = this.radius;
    target.phi = this.phi;
    target.theta = this.theta;

    return target;
  }

  /**
   * Creates a copy of this spherical
   * @returns A new `Spherical` with the same values
   */
  public clone(): Spherical {
    return new Spherical().copyFrom(this);
  }

  /**
   * Checks whether `other` matches this spherical
   * @param other - The spherical to compare with
   * @returns `true` when `radius`, `phi` and `theta` match exactly (no epsilon tolerance)
   */
  public equals(other: Spherical): boolean {
    return other.radius === this.radius && other.phi === this.phi && other.theta === this.theta;
  }

  /**
   * Restricts `phi` to `(EPS, PI - EPS)` so the polar angle never sits exactly at a pole
   *
   * Essential for orbit controls; without it, the camera flips when crossing the +Y or -Y pole.
   * @returns This spherical, for chaining
   */
  public makeSafe(): this {
    const EPS = 0.000001;
    this.phi = clamp(this.phi, EPS, Math.PI - EPS);

    return this;
  }

  /**
   * Sets this spherical from the Cartesian point `v`
   *
   * Equivalent to `setFromCartesianCoords(v.x, v.y, v.z)`.
   * @param v - The Cartesian point to convert
   * @returns This spherical, for chaining
   */
  public setFromPoint3D(v: PointData3D): this {
    return this.setFromCartesianCoords(v.x, v.y, v.z);
  }

  /**
   * Sets this spherical from Cartesian `(x, y, z)`
   *
   * Zero-radius inputs collapse `theta` and `phi` to 0.
   * @param x - Position on the x axis
   * @param y - Position on the y axis
   * @param z - Position on the z axis
   * @returns This spherical, for chaining
   */
  public setFromCartesianCoords(x: number, y: number, z: number): this {
    this.radius = Math.sqrt(x * x + y * y + z * z);

    if (this.radius === 0) {
      this.theta = 0;
      this.phi = 0;
    } else {
      this.theta = Math.atan2(x, z);
      this.phi = Math.acos(clamp(y / this.radius, -1, 1));
    }

    return this;
  }

  /**
   * Returns a readable string representation of this spherical
   * @returns A string describing the spherical's components
   */
  public toString(): string {
    return `[pixi-3d/math:Spherical radius=${this.radius} phi=${this.phi} theta=${this.theta}]`;
  }
}
