import type { Matrix3 } from '../matrix/Matrix3';
import type { Matrix4 } from '../matrix/Matrix4';
import type { Quaternion } from '../rotation/Quaternion';
import type { Cylindrical } from '../shapes/Cylindrical';
import type { Spherical } from '../shapes/Spherical';
import { clamp } from '../utils/clamp';
import type { PointData3D } from './PointData3D';
import type { PointLike3D } from './PointLike3D';

/**
 * The `Vector3` object represents a location in a three-dimensional coordinate system or a generic
 * three-component vector
 *
 * `x`, `y` and `z` are positions on the corresponding axes. Math operations follow the unified
 * mutating-default pattern: `a.add(b)` mutates `a`; `a.add(b, out)` writes the result into `out`
 * without mutating `a`.
 * @example
 * ```ts
 * const a = new Vector3(1, 2, 3);
 * const b = new Vector3(4, 5, 6);
 *
 * a.add(b); // mutates `a`, returns `a`
 *
 * const out = new Vector3();
 * a.add(b, out); // writes a + b into `out`, leaves `a` unchanged
 * ```
 * @see {@link PointData3D} For basic x,y,z interface
 * @see {@link PointLike3D} For point manipulation interface
 * @see {@link ObservableVector3} For the observable counterpart
 * @category maths
 * @standard
 */
export class Vector3 implements PointLike3D {
  /** Position of the point on the x axis */
  public x = 0;
  /** Position of the point on the y axis */
  public y = 0;
  /** Position of the point on the z axis */
  public z = 0;

  /**
   * A static `Vector3` reset to `(0, 0, 0)` on every access
   *
   * > [!IMPORTANT] This point is shared and temporary. Do not store references to it.
   * @returns The shared scratch vector
   */
  static get shared(): Vector3 {
    _shared.x = 0;
    _shared.y = 0;
    _shared.z = 0;

    return _shared;
  }

  /**
   * Creates a new `Vector3`
   * @param x - Position on the x axis
   * @param y - Position on the y axis
   * @param z - Position on the z axis
   */
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  /**
   * Sets the point to a new x, y, z position
   * @param x - Position on the x axis
   * @param y - Position on the y axis, defaults to `x`
   * @param z - Position on the z axis, defaults to `x`
   * @returns This point, for chaining
   */
  public set(x = 0, y = x, z = x): this {
    this.x = x;
    this.y = y;
    this.z = z;

    return this;
  }

  /**
   * Copies x, y, z from the given point into this point
   * @param p - The point to copy from
   * @returns This point, for chaining
   */
  public copyFrom(p: PointData3D): this {
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;

    return this;
  }

  /**
   * Copies this point's x, y, z into the given point
   * @param p - The point to copy into
   * @returns The given point with values updated
   */
  public copyTo<T extends PointLike3D>(p: T): T {
    p.set(this.x, this.y, this.z);

    return p;
  }

  /**
   * Checks if another point is equal to this point
   * @param p - The point to check
   * @returns `true` when `x`, `y` and `z` all match exactly (no epsilon tolerance)
   */
  public equals(p: PointData3D): boolean {
    return p.x === this.x && p.y === this.y && p.z === this.z;
  }

  /**
   * Creates a copy of this point
   * @returns A new `Vector3` with the same component values
   */
  public clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  /**
   * Returns a readable string representation of this point
   * @returns A string describing the point's components
   */
  public toString(): string {
    return `[pixi-3d/math:Vector3 x=${this.x} y=${this.y} z=${this.z}]`;
  }

  /**
   * Reads `x`, `y`, `z` from `array` starting at `offset`
   * @param array - The array to read from
   * @param offset - The index of the first component
   * @returns This point, for chaining
   */
  public fromArray(array: number[] | Float32Array, offset = 0): this {
    this.x = array[offset];
    this.y = array[offset + 1];
    this.z = array[offset + 2];

    return this;
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
    array[offset] = this.x;
    array[offset + 1] = this.y;
    array[offset + 2] = this.z;

    return array;
  }

  /**
   * Adds `v` to this point
   * @param v - The point to add
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public add(v: PointData3D, out: PointLike3D = this): this {
    out.x = this.x + v.x;
    out.y = this.y + v.y;
    out.z = this.z + v.z;

    return out as this;
  }

  /**
   * Subtracts `v` from this point
   * @param v - The point to subtract
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public subtract(v: PointData3D, out: PointLike3D = this): this {
    out.x = this.x - v.x;
    out.y = this.y - v.y;
    out.z = this.z - v.z;

    return out as this;
  }

  /**
   * Component-wise multiplies this point by `v`
   * @param v - The point to multiply by
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public multiply(v: PointData3D, out: PointLike3D = this): this {
    out.x = this.x * v.x;
    out.y = this.y * v.y;
    out.z = this.z * v.z;

    return out as this;
  }

  /**
   * Multiplies each component of this point by the scalar `s`
   * @param s - The scalar to multiply by
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public multiplyScalar(s: number, out: PointLike3D = this): this {
    out.x = this.x * s;
    out.y = this.y * s;
    out.z = this.z * s;

    return out as this;
  }

  /**
   * Component-wise divides this point by `v`
   * @param v - The point to divide by
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public divide(v: PointData3D, out: PointLike3D = this): this {
    out.x = this.x / v.x;
    out.y = this.y / v.y;
    out.z = this.z / v.z;

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
    out.x = this.x + v.x * s;
    out.y = this.y + v.y * s;
    out.z = this.z + v.z * s;

    return out as this;
  }

  /**
   * Negates each component of this point
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public negate(out: PointLike3D = this): this {
    out.x = -this.x;
    out.y = -this.y;
    out.z = -this.z;

    return out as this;
  }

  /**
   * Component-wise minimum of this point and `v`
   * @param v - The point to compare with
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public min(v: PointData3D, out: PointLike3D = this): this {
    out.x = Math.min(this.x, v.x);
    out.y = Math.min(this.y, v.y);
    out.z = Math.min(this.z, v.z);

    return out as this;
  }

  /**
   * Component-wise maximum of this point and `v`
   * @param v - The point to compare with
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public max(v: PointData3D, out: PointLike3D = this): this {
    out.x = Math.max(this.x, v.x);
    out.y = Math.max(this.y, v.y);
    out.z = Math.max(this.z, v.z);

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
    out.x = clamp(this.x, min.x, max.x);
    out.y = clamp(this.y, min.y, max.y);
    out.z = clamp(this.z, min.z, max.z);

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
    const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z) || 1;
    const inv = 1 / len;
    out.x = this.x * inv;
    out.y = this.y * inv;
    out.z = this.z * inv;

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
    const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z) || 1;
    const inv = length / len;
    out.x = this.x * inv;
    out.y = this.y * inv;
    out.z = this.z * inv;

    return out as this;
  }

  /**
   * Computes the magnitude (length) of this point
   * @returns The magnitude
   */
  public magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  /**
   * Computes the squared magnitude of this point
   *
   * Cheaper than `magnitude()` for length comparisons.
   * @returns The squared magnitude
   */
  public magnitudeSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
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
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;

    return dx * dx + dy * dy + dz * dz;
  }

  /**
   * Computes the dot product of this point and `v`
   * @param v - The other point
   * @returns The dot product
   */
  public dot(v: PointData3D): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
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
    const ax = this.x;
    const ay = this.y;
    const az = this.z;
    const bx = v.x;
    const by = v.y;
    const bz = v.z;
    out.x = ay * bz - az * by;
    out.y = az * bx - ax * bz;
    out.z = ax * by - ay * bx;

    return out as this;
  }

  /**
   * Applies a {@link Matrix3} (column-major) to this point
   * @param m - The matrix to apply
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public applyMatrix3(m: Matrix3, out: PointLike3D = this): this {
    const x = this.x;
    const y = this.y;
    const z = this.z;
    const e = m.elements;
    out.x = e[0] * x + e[3] * y + e[6] * z;
    out.y = e[1] * x + e[4] * y + e[7] * z;
    out.z = e[2] * x + e[5] * y + e[8] * z;

    return out as this;
  }

  /**
   * Applies a {@link Matrix4} to this point, treating it as a position (`w = 1`) and performing
   * the perspective divide
   *
   * Use {@link Vector3#transformDirection} for direction vectors.
   * @param m - The matrix to apply
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public applyMatrix4(m: Matrix4, out: PointLike3D = this): this {
    const x = this.x;
    const y = this.y;
    const z = this.z;
    const e = m.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    out.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    out.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    out.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;

    return out as this;
  }

  /**
   * Like {@link Vector3#applyMatrix4} but assumes `m` is affine (bottom row `[0, 0, 0, 1]`) and
   * skips the perspective divide
   *
   * Use for world-matrix transforms where no projection is involved.
   * @param m - The affine matrix to apply
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public applyAffineMatrix4(m: Matrix4, out: PointLike3D = this): this {
    const x = this.x;
    const y = this.y;
    const z = this.z;
    const e = m.elements;
    out.x = e[0] * x + e[4] * y + e[8] * z + e[12];
    out.y = e[1] * x + e[5] * y + e[9] * z + e[13];
    out.z = e[2] * x + e[6] * y + e[10] * z + e[14];

    return out as this;
  }

  /**
   * Rotates this point by the unit {@link Quaternion} `q`
   * @param q - The unit quaternion to rotate by
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public applyQuaternion(q: Quaternion, out: PointLike3D = this): this {
    const x = this.x;
    const y = this.y;
    const z = this.z;
    const qx = q.x;
    const qy = q.y;
    const qz = q.z;
    const qw = q.w;

    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;

    out.x = ix * qw - iw * qx - iy * qz + iz * qy;
    out.y = iy * qw - iw * qy - iz * qx + ix * qz;
    out.z = iz * qw - iw * qz - ix * qy + iy * qx;

    return out as this;
  }

  /**
   * Treats this point as a direction and applies the upper-left 3x3 of {@link Matrix4} `m`,
   * ignoring translation
   *
   * The result is normalized to unit length.
   * @param m - The matrix whose rotation to apply
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public transformDirection(m: Matrix4, out: PointLike3D = this): this {
    const x = this.x;
    const y = this.y;
    const z = this.z;
    const e = m.elements;
    const tx = e[0] * x + e[4] * y + e[8] * z;
    const ty = e[1] * x + e[5] * y + e[9] * z;
    const tz = e[2] * x + e[6] * y + e[10] * z;
    const len = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    const inv = 1 / len;
    out.x = tx * inv;
    out.y = ty * inv;
    out.z = tz * inv;

    return out as this;
  }

  /**
   * Sets this point to the Cartesian position represented by the {@link Spherical} coordinate `s`
   *
   * `phi` is the polar angle measured from the +Y axis; `theta` is the azimuthal angle measured
   * from the +Z axis.
   * @param s - The spherical coordinate to convert
   * @returns This point, for chaining
   */
  public setFromSpherical(s: Spherical): this {
    const sinPhiRadius = Math.sin(s.phi) * s.radius;

    this.x = sinPhiRadius * Math.sin(s.theta);
    this.y = Math.cos(s.phi) * s.radius;
    this.z = sinPhiRadius * Math.cos(s.theta);

    return this;
  }

  /**
   * Sets this point to the Cartesian position represented by the {@link Cylindrical} coordinate `c`
   *
   * `theta` is the azimuthal angle measured from the +Z axis; `y` is the height above the XZ plane.
   * @param c - The cylindrical coordinate to convert
   * @returns This point, for chaining
   */
  public setFromCylindrical(c: Cylindrical): this {
    this.x = c.radius * Math.sin(c.theta);
    this.y = c.y;
    this.z = c.radius * Math.cos(c.theta);

    return this;
  }

  /**
   * Reads column `index` of the column-major {@link Matrix4} `m` into this point (only the first
   * three components of the column are read)
   * @param m - The matrix to read from
   * @param index - The column index
   * @returns This point, for chaining
   */
  public setFromMatrixColumn(m: Matrix4, index: number): this {
    return this.fromArray(m.elements, index * 4);
  }
}

const _shared = new Vector3();
