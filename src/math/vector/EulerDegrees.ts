import { DEG_TO_RAD, RAD_TO_DEG } from 'pixi.js';

import type { ObservableVector3 } from './ObservableVector3';
import type { PointData3D } from './PointData3D';
import type { PointLike3D } from './PointLike3D';

/**
 * Live degree view over an {@link ObservableVector3} of radians, backing {@link Container3D.angle}
 *
 * Stores nothing of its own: every read converts the radians it wraps, and every write converts
 * back and goes through the vector's observer, so `rotation` and `angle` always agree and the node
 * is marked dirty as usual.
 * @internal
 */
export class EulerDegrees implements PointLike3D {
  constructor(private readonly _radians: ObservableVector3) {}

  /** Rotation about x, in degrees */
  get x(): number {
    return this._radians._x * RAD_TO_DEG;
  }

  set x(value: number) {
    this._radians.x = value * DEG_TO_RAD;
  }

  /** Rotation about y, in degrees */
  get y(): number {
    return this._radians._y * RAD_TO_DEG;
  }

  set y(value: number) {
    this._radians.y = value * DEG_TO_RAD;
  }

  /** Rotation about z, in degrees */
  get z(): number {
    return this._radians._z * RAD_TO_DEG;
  }

  set z(value: number) {
    this._radians.z = value * DEG_TO_RAD;
  }

  /**
   * Sets all three angles at once, notifying the observer at most once
   * @param x - Degrees about x
   * @param y - Degrees about y, defaults to `x`
   * @param z - Degrees about z, defaults to `x`
   * @returns This view, for chaining
   */
  public set(x = 0, y = x, z = x): this {
    this._radians.set(x * DEG_TO_RAD, y * DEG_TO_RAD, z * DEG_TO_RAD);

    return this;
  }

  /**
   * Copies degrees from `p`
   * @param p - Angles in degrees
   * @returns This view, for chaining
   */
  public copyFrom(p: PointData3D): this {
    return this.set(p.x, p.y, p.z);
  }

  /**
   * Copies the angles, in degrees, into `p`
   * @param p - The point to write into
   * @returns `p`
   */
  public copyTo<T extends PointLike3D>(p: T): T {
    return p.set(this.x, this.y, this.z);
  }

  /**
   * Whether `p` holds the same angles, in degrees
   * @param p - Angles in degrees
   * @returns Whether all three match exactly
   */
  public equals(p: PointData3D): boolean {
    return p.x === this.x && p.y === this.y && p.z === this.z;
  }
}
