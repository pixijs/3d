import type { SHAPE_PRIMITIVE_3D } from '../misc/const';
import { clamp } from '../utils/clamp';
import type { PointData3D } from '../vector/PointData3D';

/**
 * A point given as `radius`, `phi` and `theta` around the origin: its distance, its angle down
 * from +Y, and its angle around +Y, measured from +Z toward +X
 *
 * Use it for anything that orbits: convert a position in, change the angles, then convert back
 * with {@link Vector3#setFromSpherical}.
 * @example
 * ```ts
 * const orbit = new Spherical().setFromPoint3D(camera.position);
 *
 * orbit.theta += 0.01;
 * orbit.phi -= 0.005;
 * orbit.makeSafe();
 * camera.position.setFromSpherical(orbit);
 * camera.lookAt({ x: 0, y: 0, z: 0 });
 * ```
 * @category maths
 * @standard
 */
export class Spherical {
  /**
   * Distance from the origin
   * @example
   * ```ts
   * orbit.radius = Math.max(2, orbit.radius - wheelDelta * 0.01);
   * ```
   */
  public radius = 0;
  /**
   * Angle in radians down from +Y: `0` points straight up, `π / 2` lies level, `π` points straight
   * down
   * @example
   * ```ts
   * orbit.phi = Math.PI / 3;
   * ```
   */
  public phi = 0;
  /**
   * Angle in radians around +Y, measured from +Z toward +X
   * @example
   * ```ts
   * orbit.theta += ticker.deltaMS * 0.0005;
   * ```
   */
  public theta = 0;

  /**
   * Names the shape without an `instanceof` check, like the `type` on pixi's 2D shapes
   * @readonly
   * @default 'spherical'
   */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- read-only discriminant
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
   * @example
   * ```ts
   * const sunDirection = new Vector3().setFromSpherical(new Spherical().set(1, sunPolarAngle, sunAzimuth));
   * ```
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
   * @example
   * ```ts
   * savedView.copyFrom(orbit);
   * ```
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
   * @example
   * ```ts
   * orbit.copyTo(savedView);
   * ```
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
   * @example
   * ```ts
   * const resetView = orbit.clone();
   * ```
   * @returns A new `Spherical` with the same values
   */
  public clone(): Spherical {
    return new Spherical().copyFrom(this);
  }

  /**
   * Checks whether `other` matches this spherical
   * @example
   * ```ts
   * if (!orbit.equals(lastOrbit)) saveCameraState(orbit);
   * ```
   * @param other - The spherical to compare with
   * @returns `true` when `radius`, `phi` and `theta` match exactly (no epsilon tolerance)
   */
  public equals(other: Spherical): boolean {
    return other.radius === this.radius && other.phi === this.phi && other.theta === this.theta;
  }

  /**
   * Keeps `phi` a millionth of a radian away from both poles
   *
   * A camera that looks at its target with +Y up flips at a pole, so call this after changing
   * `phi` and before converting back.
   * @example
   * ```ts
   * orbit.phi -= pointerDeltaY * 0.01;
   * orbit.makeSafe();
   * ```
   * @returns This spherical, for chaining
   */
  public makeSafe(): this {
    const EPS = 0.000001;
    this.phi = clamp(this.phi, EPS, Math.PI - EPS);

    return this;
  }

  /**
   * Sets this spherical from the Cartesian point `v`
   * @example
   * ```ts
   * const orbit = new Spherical().setFromPoint3D(camera.position);
   * ```
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
   * @example
   * ```ts
   * orbit.setFromCartesianCoords(eye.x - target.x, eye.y - target.y, eye.z - target.z);
   * ```
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
   * @returns A string in the form `[@pixi/3d/math:Spherical radius=1 phi=0 theta=0]`
   * @advanced
   */
  public toString(): string {
    return `[@pixi/3d/math:Spherical radius=${this.radius} phi=${this.phi} theta=${this.theta}]`;
  }
}
