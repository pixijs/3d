import type { Matrix4 } from '../matrix/Matrix4';
import { clamp } from '../utils/clamp';
import type { PointData4D } from './PointData4D';
import type { PointLike4D } from './PointLike4D';

/**
 * The `Vector4` object represents a homogeneous-coordinate position or a generic four-component vector
 *
 * By convention `w` defaults to `1`, treating instances as positions; pass `w = 0` for
 * direction vectors.
 *
 * Many `@pixi/3d` functions accept the `PointData4D` type as an alternative to `Vector4`, which only
 * requires `x`, `y`, `z` and `w` properties.
 * @example
 * ```ts
 * // Basic point creation (homogeneous position)
 * const point = new Vector4(100, 200, 300, 1);
 *
 * // Direction vector (w = 0)
 * const direction = new Vector4(1, 0, 0, 0);
 *
 * // Math operations are mutating-default with optional out parameter
 * const a = new Vector4(1, 2, 3, 1);
 * const b = new Vector4(4, 5, 6, 1);
 *
 * a.add(b); // mutates `a`, returns `a`
 *
 * const out = new Vector4();
 * a.add(b, out); // writes a + b into `out`, leaves `a` unchanged
 * ```
 * @see {@link PointData4D} For basic x,y,z,w interface
 * @see {@link PointLike4D} For point manipulation interface
 * @category maths
 * @standard
 */
export class Vector4 implements PointLike4D {
  /** Position of the point on the x axis */
  public x = 0;
  /** Position of the point on the y axis */
  public y = 0;
  /** Position of the point on the z axis */
  public z = 0;
  /** Homogeneous coordinate; `1` for positions and `0` for direction vectors by convention */
  public w = 1;

  /**
   * A static `Vector4` reset to `(0, 0, 0, 1)` on every access
   *
   * > [!IMPORTANT] This point is shared and temporary. Do not store references to it.
   */
  static get shared(): Vector4 {
    _shared.x = 0;
    _shared.y = 0;
    _shared.z = 0;
    _shared.w = 1;

    return _shared;
  }

  /**
   * Creates a new `Vector4`
   * @param x - Position on the x axis
   * @param y - Position on the y axis
   * @param z - Position on the z axis
   * @param w - Position on the w axis (defaults to `1`)
   */
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  /**
   * Sets the point to a new x, y, z, w position
   *
   * If `y` or `z` is omitted, both default to `x`. `w` defaults to `1` to match the
   * homogeneous-coord position convention.
   * @param x - Position on the x axis
   * @param y - Position on the y axis (defaults to `x`)
   * @param z - Position on the z axis (defaults to `x`)
   * @param w - Position on the w axis (defaults to `1`)
   * @returns This point, for chaining
   */
  public set(x = 0, y = x, z = x, w = 1): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;

    return this;
  }

  /**
   * Copies x, y, z, w from the given point into this point
   * @param p - The point to copy from
   * @returns This point, for chaining
   */
  public copyFrom(p: PointData4D): this {
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;
    this.w = p.w;

    return this;
  }

  /**
   * Copies this point's x, y, z, w into the given point
   * @param p - The point to copy into
   * @returns The given point
   */
  public copyTo<T extends PointLike4D>(p: T): T {
    p.set(this.x, this.y, this.z, this.w);

    return p;
  }

  /**
   * Checks whether `x`, `y`, `z` and `w` all match exactly (no epsilon tolerance)
   * @param p - The point to compare against
   * @returns `true` when all four components are equal
   */
  public equals(p: PointData4D): boolean {
    return p.x === this.x && p.y === this.y && p.z === this.z && p.w === this.w;
  }

  /**
   * Creates a copy of this point
   * @returns A new `Vector4` with the same component values
   */
  public clone(): Vector4 {
    return new Vector4(this.x, this.y, this.z, this.w);
  }

  /**
   * Builds a debug string for this point
   * @returns A string of the form `[pixi-3d/math:Vector4 x=... y=... z=... w=...]`
   */
  public toString(): string {
    return `[pixi-3d/math:Vector4 x=${this.x} y=${this.y} z=${this.z} w=${this.w}]`;
  }

  /**
   * Reads `x`, `y`, `z`, `w` from `array` starting at `offset`
   * @param array - The source array
   * @param offset - Index of the first component in `array`
   * @returns This point, for chaining
   */
  public fromArray(array: number[] | Float32Array, offset = 0): this {
    this.x = array[offset];
    this.y = array[offset + 1];
    this.z = array[offset + 2];
    this.w = array[offset + 3];

    return this;
  }

  /**
   * Writes this point's values into `array` starting at `offset`
   *
   * Allocates a new array when one is not supplied.
   * @param array - The destination array; created when omitted
   * @param offset - Index of the first component in `array`
   * @returns The destination array
   */
  public toArray<T extends number[] | Float32Array = number[]>(array: T = [] as unknown as T, offset = 0): T {
    array[offset] = this.x;
    array[offset + 1] = this.y;
    array[offset + 2] = this.z;
    array[offset + 3] = this.w;

    return array;
  }

  /**
   * Adds `v` to this point
   * @param v - The point to add
   * @param out - Receives the result; defaults to this point (mutating)
   * @returns The `out` point
   */
  public add(v: PointData4D, out: PointLike4D = this): this {
    out.x = this.x + v.x;
    out.y = this.y + v.y;
    out.z = this.z + v.z;
    out.w = this.w + v.w;

    return out as this;
  }

  /**
   * Subtracts `v` from this point
   * @param v - The point to subtract
   * @param out - Receives the result; defaults to this point (mutating)
   * @returns The `out` point
   */
  public subtract(v: PointData4D, out: PointLike4D = this): this {
    out.x = this.x - v.x;
    out.y = this.y - v.y;
    out.z = this.z - v.z;
    out.w = this.w - v.w;

    return out as this;
  }

  /**
   * Component-wise multiplies this point by `v`
   * @param v - The point to multiply by
   * @param out - Receives the result; defaults to this point (mutating)
   * @returns The `out` point
   */
  public multiply(v: PointData4D, out: PointLike4D = this): this {
    out.x = this.x * v.x;
    out.y = this.y * v.y;
    out.z = this.z * v.z;
    out.w = this.w * v.w;

    return out as this;
  }

  /**
   * Multiplies each component of this point by the scalar `s`
   * @param s - The scalar to multiply by
   * @param out - Receives the result; defaults to this point (mutating)
   * @returns The `out` point
   */
  public multiplyScalar(s: number, out: PointLike4D = this): this {
    out.x = this.x * s;
    out.y = this.y * s;
    out.z = this.z * s;
    out.w = this.w * s;

    return out as this;
  }

  /**
   * Component-wise divides this point by `v`
   * @param v - The point to divide by
   * @param out - Receives the result; defaults to this point (mutating)
   * @returns The `out` point
   */
  public divide(v: PointData4D, out: PointLike4D = this): this {
    out.x = this.x / v.x;
    out.y = this.y / v.y;
    out.z = this.z / v.z;
    out.w = this.w / v.w;

    return out as this;
  }

  /**
   * Divides each component of this point by the scalar `s`
   * @param s - The scalar to divide by
   * @param out - Receives the result; defaults to this point (mutating)
   * @returns The `out` point
   */
  public divideScalar(s: number, out: PointLike4D = this): this {
    return this.multiplyScalar(1 / s, out);
  }

  /**
   * Adds `v * s` to this point
   * @param v - The point to scale and add
   * @param s - The scalar applied to `v`
   * @param out - Receives the result; defaults to this point (mutating)
   * @returns The `out` point
   */
  public addScaledVector(v: PointData4D, s: number, out: PointLike4D = this): this {
    out.x = this.x + v.x * s;
    out.y = this.y + v.y * s;
    out.z = this.z + v.z * s;
    out.w = this.w + v.w * s;

    return out as this;
  }

  /**
   * Negates each component of this point
   * @param out - Receives the result; defaults to this point (mutating)
   * @returns The `out` point
   */
  public negate(out: PointLike4D = this): this {
    out.x = -this.x;
    out.y = -this.y;
    out.z = -this.z;
    out.w = -this.w;

    return out as this;
  }

  /**
   * Component-wise minimum of this point and `v`
   * @param v - The point to compare against
   * @param out - Receives the result; defaults to this point (mutating)
   * @returns The `out` point
   */
  public min(v: PointData4D, out: PointLike4D = this): this {
    out.x = Math.min(this.x, v.x);
    out.y = Math.min(this.y, v.y);
    out.z = Math.min(this.z, v.z);
    out.w = Math.min(this.w, v.w);

    return out as this;
  }

  /**
   * Component-wise maximum of this point and `v`
   * @param v - The point to compare against
   * @param out - Receives the result; defaults to this point (mutating)
   * @returns The `out` point
   */
  public max(v: PointData4D, out: PointLike4D = this): this {
    out.x = Math.max(this.x, v.x);
    out.y = Math.max(this.y, v.y);
    out.z = Math.max(this.z, v.z);
    out.w = Math.max(this.w, v.w);

    return out as this;
  }

  /**
   * Component-wise clamp of this point between `min` and `max`
   *
   * Assumes `min <= max` componentwise.
   * @param min - The lower bound per component
   * @param max - The upper bound per component
   * @param out - Receives the result; defaults to this point (mutating)
   * @returns The `out` point
   */
  public clamp(min: PointData4D, max: PointData4D, out: PointLike4D = this): this {
    out.x = clamp(this.x, min.x, max.x);
    out.y = clamp(this.y, min.y, max.y);
    out.z = clamp(this.z, min.z, max.z);
    out.w = clamp(this.w, min.w, max.w);

    return out as this;
  }

  /**
   * Normalizes this point to unit length across all four components
   *
   * Zero-magnitude points are left unchanged.
   * @param out - Receives the result; defaults to this point (mutating)
   * @returns The `out` point
   */
  public normalize(out: PointLike4D = this): this {
    const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w) || 1;
    const inv = 1 / len;
    out.x = this.x * inv;
    out.y = this.y * inv;
    out.z = this.z * inv;
    out.w = this.w * inv;

    return out as this;
  }

  /**
   * Rescales this point so its magnitude equals `length`
   *
   * Zero-magnitude points are left unchanged.
   * @param length - The target magnitude
   * @param out - Receives the result; defaults to this point (mutating)
   * @returns The `out` point
   */
  public setLength(length: number, out: PointLike4D = this): this {
    const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w) || 1;
    const inv = length / len;
    out.x = this.x * inv;
    out.y = this.y * inv;
    out.z = this.z * inv;
    out.w = this.w * inv;

    return out as this;
  }

  /**
   * Computes the magnitude (length) of this point
   * @returns The magnitude
   */
  public magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
  }

  /**
   * Computes the squared magnitude of this point
   *
   * Cheaper than `magnitude()` for length comparisons.
   * @returns The squared magnitude
   */
  public magnitudeSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }

  /**
   * Computes the Euclidean distance from this point to `v`
   * @param v - The point to measure to
   * @returns The distance
   */
  public distanceTo(v: PointData4D): number {
    return Math.sqrt(this.distanceToSquared(v));
  }

  /**
   * Computes the squared Euclidean distance from this point to `v`
   * @param v - The point to measure to
   * @returns The squared distance
   */
  public distanceToSquared(v: PointData4D): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    const dw = this.w - v.w;

    return dx * dx + dy * dy + dz * dz + dw * dw;
  }

  /**
   * Computes the dot product of this point and `v`
   * @param v - The other point
   * @returns The dot product
   */
  public dot(v: PointData4D): number {
    return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;
  }

  /**
   * Computes the angle in radians between this point and `v`
   * @param v - The other point
   * @returns The angle in radians
   */
  public angleTo(v: PointData4D): number {
    const denominator = Math.sqrt(this.magnitudeSquared() * (v.x * v.x + v.y * v.y + v.z * v.z + v.w * v.w));
    if (denominator === 0) return Math.PI / 2;
    const theta = this.dot(v) / denominator;

    return Math.acos(clamp(theta, -1, 1));
  }

  /**
   * Applies a {@link Matrix4} to this 4D point, treating it as a homogeneous-coord vector
   *
   * No perspective divide; `w` is transformed as the fourth component, so positions with `w = 1`
   * and direction vectors with `w = 0` transform correctly.
   * @param m - The matrix to apply
   * @param out - Receives the result; defaults to this point (mutating)
   * @returns The `out` point
   */
  public applyMatrix4(m: Matrix4, out: PointLike4D = this): this {
    const x = this.x;
    const y = this.y;
    const z = this.z;
    const w = this.w;
    const e = m.elements;
    out.x = e[0] * x + e[4] * y + e[8] * z + e[12] * w;
    out.y = e[1] * x + e[5] * y + e[9] * z + e[13] * w;
    out.z = e[2] * x + e[6] * y + e[10] * z + e[14] * w;
    out.w = e[3] * x + e[7] * y + e[11] * z + e[15] * w;

    return out as this;
  }
}

const _shared = new Vector4();
