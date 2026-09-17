import type { Observer } from 'pixi.js';

import type { Matrix3 } from '../matrix/Matrix3';
import type { Matrix4 } from '../matrix/Matrix4';
import type { Quaternion } from '../rotation/Quaternion';
import type { Cylindrical } from '../shapes/Cylindrical';
import type { Spherical } from '../shapes/Spherical';
import { clamp } from '../utils/clamp';
import type { PointData3D } from './PointData3D';
import type { PointLike3D } from './PointLike3D';

/**
 * The `ObservableVector3` object represents a location in a three-dimensional coordinate system
 * that fires an observer callback whenever its components change
 *
 * It mirrors the API of {@link Vector3}, making it suitable for transform properties (position,
 * scale) where change detection drives downstream updates.
 *
 * Math operations follow the unified mutating-default pattern: `a.add(b)` mutates `a` in place;
 * `a.add(b, out)` writes the result into `out` instead. In-place mutations route through
 * {@link ObservableVector3#set} so the observer fires exactly once per call, even though the
 * implementation computes each component separately. When `out` is a different point, this point's
 * observer is not fired.
 * @see {@link Vector3} For the non-observable counterpart
 * @see {@link Observer} For the observer interface
 * @category maths
 * @standard
 */
export class ObservableVector3 implements PointLike3D {
  /** @ignore */
  public _x: number;
  /** @ignore */
  public _y: number;
  /** @ignore */
  public _z: number;

  /** Object whose `_onUpdate` callback is invoked when this point changes */
  private readonly _observer: Observer<ObservableVector3>;

  /** Position of the point on the x axis; assigning a different value fires the observer */
  get x(): number {
    return this._x;
  }

  /**
   * Sets the x component; fires the observer only when the value changes
   * @param value - New position on the x axis
   */
  set x(value: number) {
    if (this._x !== value) {
      this._x = value;
      this._observer._onUpdate(this);
    }
  }

  /** Position of the point on the y axis; assigning a different value fires the observer */
  get y(): number {
    return this._y;
  }

  /**
   * Sets the y component; fires the observer only when the value changes
   * @param value - New position on the y axis
   */
  set y(value: number) {
    if (this._y !== value) {
      this._y = value;
      this._observer._onUpdate(this);
    }
  }

  /** Position of the point on the z axis; assigning a different value fires the observer */
  get z(): number {
    return this._z;
  }

  /**
   * Sets the z component; fires the observer only when the value changes
   * @param value - New position on the z axis
   */
  set z(value: number) {
    if (this._z !== value) {
      this._z = value;
      this._observer._onUpdate(this);
    }
  }

  /**
   * Creates a new `ObservableVector3`
   * @param observer - Observer notified when any component changes
   * @param x - Position of the point on the x axis
   * @param y - Position of the point on the y axis
   * @param z - Position of the point on the z axis
   */
  constructor(observer: Observer<ObservableVector3>, x = 0, y = 0, z = 0) {
    this._x = x;
    this._y = y;
    this._z = z;
    this._observer = observer;
  }

  /**
   * Sets the point to a new x, y and z position
   *
   * The observer fires once if any component changes, and not at all otherwise.
   * @param x - Position on the x axis
   * @param y - Position on the y axis, defaults to `x`
   * @param z - Position on the z axis, defaults to `x`
   * @returns This point, for chaining
   */
  public set(x = 0, y = x, z = x): this {
    if (this._x !== x || this._y !== y || this._z !== z) {
      this._x = x;
      this._y = y;
      this._z = z;
      this._observer._onUpdate(this);
    }

    return this;
  }

  /**
   * Copies x, y, z from the given point into this point
   *
   * The observer fires only when at least one component differs from the current value.
   * @param p - The point to copy from
   * @returns This point, for chaining
   */
  public copyFrom(p: PointData3D): this {
    if (this._x !== p.x || this._y !== p.y || this._z !== p.z) {
      this._x = p.x;
      this._y = p.y;
      this._z = p.z;
      this._observer._onUpdate(this);
    }

    return this;
  }

  /**
   * Copies this point's x, y, z into the given point
   * @param p - The point to copy into
   * @returns The given point with values updated
   */
  public copyTo<T extends PointLike3D>(p: T): T {
    p.set(this._x, this._y, this._z);

    return p;
  }

  /**
   * Checks if another point is equal to this point
   * @param p - The point to check
   * @returns `true` when `x`, `y` and `z` all match exactly (no epsilon tolerance)
   */
  public equals(p: PointData3D): boolean {
    return p.x === this._x && p.y === this._y && p.z === this._z;
  }

  /**
   * Creates a copy of this point
   *
   * The clone reuses this instance's observer unless `observer` is provided explicitly.
   * @param observer - Optional observer for the clone
   * @returns A new `ObservableVector3` with the same component values
   */
  public clone(observer?: Observer<ObservableVector3>): ObservableVector3 {
    return new ObservableVector3(observer ?? this._observer, this._x, this._y, this._z);
  }

  /**
   * Returns a readable string representation of this point
   * @returns A string describing the point's components
   */
  public toString(): string {
    return `[pixi-3d/math:ObservableVector3 x=${this._x} y=${this._y} z=${this._z}]`;
  }

  /**
   * Reads `x`, `y`, `z` from `array` starting at `offset`
   *
   * The observer fires once if any component changes.
   * @param array - The array to read from
   * @param offset - The index of the first component
   * @returns This point, for chaining
   */
  public fromArray(array: number[] | Float32Array, offset = 0): this {
    return this.set(array[offset], array[offset + 1], array[offset + 2]);
  }

  /**
   * Writes this point's values into `array` starting at `offset`
   *
   * Allocates a new array when one is not supplied.
   * @param array - The array to write into
   * @param offset - The index to write the first component at
   * @returns The array the values were written into
   */
  public toArray<T extends number[] | Float32Array = number[]>(array: T = [] as unknown as T, offset = 0): T {
    array[offset] = this._x;
    array[offset + 1] = this._y;
    array[offset + 2] = this._z;

    return array;
  }

  /**
   * Adds `v` to this point
   * @param v - The point to add
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public add(v: PointData3D, out: PointLike3D = this): this {
    const x = this._x + v.x;
    const y = this._y + v.y;
    const z = this._z + v.z;
    if (out === this) return this.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;

    return out as this;
  }

  /**
   * Subtracts `v` from this point
   * @param v - The point to subtract
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public subtract(v: PointData3D, out: PointLike3D = this): this {
    const x = this._x - v.x;
    const y = this._y - v.y;
    const z = this._z - v.z;
    if (out === this) return this.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;

    return out as this;
  }

  /**
   * Component-wise multiplies this point by `v`
   * @param v - The point to multiply by
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public multiply(v: PointData3D, out: PointLike3D = this): this {
    const x = this._x * v.x;
    const y = this._y * v.y;
    const z = this._z * v.z;
    if (out === this) return this.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;

    return out as this;
  }

  /**
   * Multiplies each component of this point by the scalar `s`
   * @param s - The scalar to multiply by
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public multiplyScalar(s: number, out: PointLike3D = this): this {
    const x = this._x * s;
    const y = this._y * s;
    const z = this._z * s;
    if (out === this) return this.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;

    return out as this;
  }

  /**
   * Component-wise divides this point by `v`
   * @param v - The point to divide by
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public divide(v: PointData3D, out: PointLike3D = this): this {
    const x = this._x / v.x;
    const y = this._y / v.y;
    const z = this._z / v.z;
    if (out === this) return this.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;

    return out as this;
  }

  /**
   * Divides each component of this point by the scalar `s`
   * @param s - The scalar to divide by
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public divideScalar(s: number, out: PointLike3D = this): this {
    return this.multiplyScalar(1 / s, out);
  }

  /**
   * Adds `v * s` to this point
   * @param v - The point to scale and add
   * @param s - The scalar to multiply `v` by
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public addScaledVector(v: PointData3D, s: number, out: PointLike3D = this): this {
    const x = this._x + v.x * s;
    const y = this._y + v.y * s;
    const z = this._z + v.z * s;
    if (out === this) return this.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;

    return out as this;
  }

  /**
   * Negates each component of this point
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public negate(out: PointLike3D = this): this {
    const x = -this._x;
    const y = -this._y;
    const z = -this._z;
    if (out === this) return this.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;

    return out as this;
  }

  /**
   * Component-wise minimum of this point and `v`
   * @param v - The point to compare with
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public min(v: PointData3D, out: PointLike3D = this): this {
    const x = Math.min(this._x, v.x);
    const y = Math.min(this._y, v.y);
    const z = Math.min(this._z, v.z);
    if (out === this) return this.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;

    return out as this;
  }

  /**
   * Component-wise maximum of this point and `v`
   * @param v - The point to compare with
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public max(v: PointData3D, out: PointLike3D = this): this {
    const x = Math.max(this._x, v.x);
    const y = Math.max(this._y, v.y);
    const z = Math.max(this._z, v.z);
    if (out === this) return this.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;

    return out as this;
  }

  /**
   * Component-wise clamp of this point between `min` and `max`
   *
   * Assumes `min <= max` componentwise.
   * @param min - The lower bound per component
   * @param max - The upper bound per component
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public clamp(min: PointData3D, max: PointData3D, out: PointLike3D = this): this {
    const x = clamp(this._x, min.x, max.x);
    const y = clamp(this._y, min.y, max.y);
    const z = clamp(this._z, min.z, max.z);
    if (out === this) return this.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;

    return out as this;
  }

  /**
   * Normalizes this point to unit length
   *
   * Zero-magnitude points are left unchanged.
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public normalize(out: PointLike3D = this): this {
    const len = Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z) || 1;
    const inv = 1 / len;
    const x = this._x * inv;
    const y = this._y * inv;
    const z = this._z * inv;
    if (out === this) return this.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;

    return out as this;
  }

  /**
   * Rescales this point so its magnitude equals `length`
   *
   * Zero-magnitude points are left unchanged.
   * @param length - The target magnitude
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public setLength(length: number, out: PointLike3D = this): this {
    const len = Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z) || 1;
    const inv = length / len;
    const x = this._x * inv;
    const y = this._y * inv;
    const z = this._z * inv;
    if (out === this) return this.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;

    return out as this;
  }

  /**
   * Computes the magnitude (length) of this point
   * @returns The magnitude
   */
  public magnitude(): number {
    return Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z);
  }

  /**
   * Computes the squared magnitude of this point
   *
   * Cheaper than `magnitude()` for length comparisons.
   * @returns The squared magnitude
   */
  public magnitudeSquared(): number {
    return this._x * this._x + this._y * this._y + this._z * this._z;
  }

  /**
   * Computes the Euclidean distance from this point to `v`
   * @param v - The point to measure to
   * @returns The distance
   */
  public distanceTo(v: PointData3D): number {
    return Math.sqrt(this.distanceToSquared(v));
  }

  /**
   * Computes the squared Euclidean distance from this point to `v`
   * @param v - The point to measure to
   * @returns The squared distance
   */
  public distanceToSquared(v: PointData3D): number {
    const dx = this._x - v.x;
    const dy = this._y - v.y;
    const dz = this._z - v.z;

    return dx * dx + dy * dy + dz * dz;
  }

  /**
   * Computes the dot product of this point and `v`
   * @param v - The other point
   * @returns The dot product
   */
  public dot(v: PointData3D): number {
    return this._x * v.x + this._y * v.y + this._z * v.z;
  }

  /**
   * Computes the angle between this point and `v`
   * @param v - The other point
   * @returns The angle in radians
   */
  public angleTo(v: PointData3D): number {
    const denominator = Math.sqrt(this.magnitudeSquared() * (v.x * v.x + v.y * v.y + v.z * v.z));
    if (denominator === 0) return Math.PI / 2;
    const theta = this.dot(v) / denominator;

    return Math.acos(clamp(theta, -1, 1));
  }

  /**
   * Computes the 3D cross product `this x v`
   * @param v - The other point
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public cross(v: PointData3D, out: PointLike3D = this): this {
    const ax = this._x;
    const ay = this._y;
    const az = this._z;
    const bx = v.x;
    const by = v.y;
    const bz = v.z;
    const x = ay * bz - az * by;
    const y = az * bx - ax * bz;
    const z = ax * by - ay * bx;
    if (out === this) return this.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;

    return out as this;
  }

  /**
   * Applies a {@link Matrix3} (column-major) to this point
   * @param m - The matrix to apply
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public applyMatrix3(m: Matrix3, out: PointLike3D = this): this {
    const ex = this._x;
    const ey = this._y;
    const ez = this._z;
    const e = m.elements;
    const x = e[0] * ex + e[3] * ey + e[6] * ez;
    const y = e[1] * ex + e[4] * ey + e[7] * ez;
    const z = e[2] * ex + e[5] * ey + e[8] * ez;
    if (out === this) return this.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;

    return out as this;
  }

  /**
   * Applies a {@link Matrix4} to this point, treating it as a position (`w = 1`) and performing
   * the perspective divide
   * @param m - The matrix to apply
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public applyMatrix4(m: Matrix4, out: PointLike3D = this): this {
    const ex = this._x;
    const ey = this._y;
    const ez = this._z;
    const e = m.elements;
    const w = 1 / (e[3] * ex + e[7] * ey + e[11] * ez + e[15]);
    const x = (e[0] * ex + e[4] * ey + e[8] * ez + e[12]) * w;
    const y = (e[1] * ex + e[5] * ey + e[9] * ez + e[13]) * w;
    const z = (e[2] * ex + e[6] * ey + e[10] * ez + e[14]) * w;
    if (out === this) return this.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;

    return out as this;
  }

  /**
   * Like {@link ObservableVector3#applyMatrix4} but assumes `m` is affine (bottom row
   * `[0, 0, 0, 1]`) and skips the perspective divide
   *
   * Use for world-matrix transforms where no projection is involved.
   * @param m - The affine matrix to apply
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public applyAffineMatrix4(m: Matrix4, out: PointLike3D = this): this {
    const ex = this._x;
    const ey = this._y;
    const ez = this._z;
    const e = m.elements;
    const x = e[0] * ex + e[4] * ey + e[8] * ez + e[12];
    const y = e[1] * ex + e[5] * ey + e[9] * ez + e[13];
    const z = e[2] * ex + e[6] * ey + e[10] * ez + e[14];
    if (out === this) return this.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;

    return out as this;
  }

  /**
   * Rotates this point by the unit {@link Quaternion} `q`
   * @param q - The unit quaternion to rotate by
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public applyQuaternion(q: Quaternion, out: PointLike3D = this): this {
    const ex = this._x;
    const ey = this._y;
    const ez = this._z;
    const qx = q.x;
    const qy = q.y;
    const qz = q.z;
    const qw = q.w;

    const ix = qw * ex + qy * ez - qz * ey;
    const iy = qw * ey + qz * ex - qx * ez;
    const iz = qw * ez + qx * ey - qy * ex;
    const iw = -qx * ex - qy * ey - qz * ez;

    const x = ix * qw - iw * qx - iy * qz + iz * qy;
    const y = iy * qw - iw * qy - iz * qx + ix * qz;
    const z = iz * qw - iw * qz - ix * qy + iy * qx;

    if (out === this) return this.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;

    return out as this;
  }

  /**
   * Treats this point as a direction and applies the rotation of {@link Matrix4} `m`, ignoring
   * translation
   *
   * The result is normalized to unit length.
   * @param m - The matrix whose rotation to apply
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public transformDirection(m: Matrix4, out: PointLike3D = this): this {
    const ex = this._x;
    const ey = this._y;
    const ez = this._z;
    const e = m.elements;
    const tx = e[0] * ex + e[4] * ey + e[8] * ez;
    const ty = e[1] * ex + e[5] * ey + e[9] * ez;
    const tz = e[2] * ex + e[6] * ey + e[10] * ez;
    const len = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    const inv = 1 / len;
    const x = tx * inv;
    const y = ty * inv;
    const z = tz * inv;
    if (out === this) return this.set(x, y, z);
    out.x = x;
    out.y = y;
    out.z = z;

    return out as this;
  }

  /**
   * Sets this point from a {@link Spherical} coordinate
   * @param s - The spherical coordinate to convert
   * @returns This point, for chaining
   */
  public setFromSpherical(s: Spherical): this {
    const sinPhiRadius = Math.sin(s.phi) * s.radius;

    return this.set(sinPhiRadius * Math.sin(s.theta), Math.cos(s.phi) * s.radius, sinPhiRadius * Math.cos(s.theta));
  }

  /**
   * Sets this point from a {@link Cylindrical} coordinate
   * @param c - The cylindrical coordinate to convert
   * @returns This point, for chaining
   */
  public setFromCylindrical(c: Cylindrical): this {
    return this.set(c.radius * Math.sin(c.theta), c.y, c.radius * Math.cos(c.theta));
  }

  /**
   * Reads column `index` of the column-major {@link Matrix4} `m` into this point
   * @param m - The matrix to read from
   * @param index - The column index
   * @returns This point, for chaining
   */
  public setFromMatrixColumn(m: Matrix4, index: number): this {
    return this.fromArray(m.elements, index * 4);
  }
}
