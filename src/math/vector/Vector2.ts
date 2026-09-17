import type { PointData, PointLike } from 'pixi.js';

import type { Matrix3 } from '../matrix/Matrix3';
import { clamp } from '../utils/clamp';

/**
 * The `Vector2` object represents a location in a two-dimensional coordinate system or a generic
 * two-component vector
 *
 * `x` and `y` are positions on the corresponding axes. Math operations follow the unified
 * mutating-default pattern: `a.add(b)` mutates `a`; `a.add(b, out)` writes the result into `out`
 * without mutating `a`.
 * @example
 * ```ts
 * const a = new Vector2(1, 2);
 * const b = new Vector2(3, 4);
 *
 * a.add(b); // mutates `a`, returns `a`
 *
 * const out = new Vector2();
 * a.add(b, out); // writes a + b into `out`, leaves `a` unchanged
 * ```
 * @category maths
 * @standard
 */
export class Vector2 implements PointLike {
  /** Position of the point on the x axis */
  public x = 0;
  /** Position of the point on the y axis */
  public y = 0;

  /**
   * A static `Vector2` reset to `(0, 0)` on every access
   *
   * > [!IMPORTANT] This vector is shared and temporary. Do not store references to it.
   * @returns The shared scratch vector
   */
  static get shared(): Vector2 {
    _shared.x = 0;
    _shared.y = 0;

    return _shared;
  }

  /**
   * Creates a new `Vector2`
   * @param x - Position on the x axis
   * @param y - Position on the y axis
   */
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  /**
   * Sets the vector to a new x, y position
   * @param x - Position on the x axis
   * @param y - Position on the y axis, defaults to `x`
   * @returns This vector, for chaining
   */
  public set(x = 0, y = x): this {
    this.x = x;
    this.y = y;

    return this;
  }

  /**
   * Copies x, y from the given point into this vector
   * @param p - The point to copy from
   * @returns This vector, for chaining
   */
  public copyFrom(p: PointData): this {
    this.x = p.x;
    this.y = p.y;

    return this;
  }

  /**
   * Copies this vector's x, y into the given point
   * @param p - The point to copy into
   * @returns The given point with values updated
   */
  public copyTo<T extends PointLike>(p: T): T {
    p.set(this.x, this.y);

    return p;
  }

  /**
   * Checks if another point is equal to this vector
   * @param p - The point to check
   * @returns `true` when `x` and `y` both match exactly (no epsilon tolerance)
   */
  public equals(p: PointData): boolean {
    return p.x === this.x && p.y === this.y;
  }

  /**
   * Creates a copy of this vector
   * @returns A new `Vector2` with the same component values
   */
  public clone(): Vector2 {
    return new Vector2(this.x, this.y);
  }

  /**
   * Returns a readable string representation of this vector
   * @returns A string describing the vector's components
   */
  public toString(): string {
    return `[pixi-3d/math:Vector2 x=${this.x} y=${this.y}]`;
  }

  /**
   * Reads `x`, `y` from `array` starting at `offset`
   * @param array - The array to read from
   * @param offset - The index of the first component
   * @returns This vector, for chaining
   */
  public fromArray(array: number[] | Float32Array, offset = 0): this {
    this.x = array[offset];
    this.y = array[offset + 1];

    return this;
  }

  /**
   * Writes this vector's values into `array` starting at `offset`
   *
   * Allocates a new array when one is not supplied.
   * @param array - The array to write into
   * @param offset - The index to write the first component at
   * @returns The array the values were written into
   */
  public toArray<T extends number[] | Float32Array = number[]>(array: T = [] as unknown as T, offset = 0): T {
    array[offset] = this.x;
    array[offset + 1] = this.y;

    return array;
  }

  /**
   * Adds `v` to this vector
   * @param v - The point to add
   * @param out - The target to write the result into, defaults to this vector
   * @returns The vector the result was written into
   */
  public add(v: PointData, out: PointLike = this): this {
    out.x = this.x + v.x;
    out.y = this.y + v.y;

    return out as this;
  }

  /**
   * Subtracts `v` from this vector
   * @param v - The point to subtract
   * @param out - The target to write the result into, defaults to this vector
   * @returns The vector the result was written into
   */
  public subtract(v: PointData, out: PointLike = this): this {
    out.x = this.x - v.x;
    out.y = this.y - v.y;

    return out as this;
  }

  /**
   * Component-wise multiplies this vector by `v`
   * @param v - The point to multiply by
   * @param out - The target to write the result into, defaults to this vector
   * @returns The vector the result was written into
   */
  public multiply(v: PointData, out: PointLike = this): this {
    out.x = this.x * v.x;
    out.y = this.y * v.y;

    return out as this;
  }

  /**
   * Multiplies each component of this vector by the scalar `s`
   * @param s - The scalar to multiply by
   * @param out - The target to write the result into, defaults to this vector
   * @returns The vector the result was written into
   */
  public multiplyScalar(s: number, out: PointLike = this): this {
    out.x = this.x * s;
    out.y = this.y * s;

    return out as this;
  }

  /**
   * Component-wise divides this vector by `v`
   * @param v - The point to divide by
   * @param out - The target to write the result into, defaults to this vector
   * @returns The vector the result was written into
   */
  public divide(v: PointData, out: PointLike = this): this {
    out.x = this.x / v.x;
    out.y = this.y / v.y;

    return out as this;
  }

  /**
   * Divides each component of this vector by the scalar `s`
   * @param s - The scalar to divide by
   * @param out - The target to write the result into, defaults to this vector
   * @returns The vector the result was written into
   */
  public divideScalar(s: number, out: PointLike = this): this {
    return this.multiplyScalar(1 / s, out);
  }

  /**
   * Adds `v * s` to this vector
   * @param v - The point to scale and add
   * @param s - The scalar to multiply `v` by
   * @param out - The target to write the result into, defaults to this vector
   * @returns The vector the result was written into
   */
  public addScaledVector(v: PointData, s: number, out: PointLike = this): this {
    out.x = this.x + v.x * s;
    out.y = this.y + v.y * s;

    return out as this;
  }

  /**
   * Negates each component of this vector
   * @param out - The target to write the result into, defaults to this vector
   * @returns The vector the result was written into
   */
  public negate(out: PointLike = this): this {
    out.x = -this.x;
    out.y = -this.y;

    return out as this;
  }

  /**
   * Component-wise minimum of this vector and `v`
   * @param v - The point to compare with
   * @param out - The target to write the result into, defaults to this vector
   * @returns The vector the result was written into
   */
  public min(v: PointData, out: PointLike = this): this {
    out.x = Math.min(this.x, v.x);
    out.y = Math.min(this.y, v.y);

    return out as this;
  }

  /**
   * Component-wise maximum of this vector and `v`
   * @param v - The point to compare with
   * @param out - The target to write the result into, defaults to this vector
   * @returns The vector the result was written into
   */
  public max(v: PointData, out: PointLike = this): this {
    out.x = Math.max(this.x, v.x);
    out.y = Math.max(this.y, v.y);

    return out as this;
  }

  /**
   * Component-wise clamp of this vector between `min` and `max`
   *
   * Assumes `min <= max` componentwise.
   * @param min - The lower bound per component
   * @param max - The upper bound per component
   * @param out - The target to write the result into, defaults to this vector
   * @returns The vector the result was written into
   */
  public clamp(min: PointData, max: PointData, out: PointLike = this): this {
    out.x = clamp(this.x, min.x, max.x);
    out.y = clamp(this.y, min.y, max.y);

    return out as this;
  }

  /**
   * Normalizes this vector to unit length
   *
   * Zero-magnitude vectors are left unchanged.
   * @param out - The target to write the result into, defaults to this vector
   * @returns The vector the result was written into
   */
  public normalize(out: PointLike = this): this {
    const len = Math.sqrt(this.x * this.x + this.y * this.y) || 1;
    const inv = 1 / len;
    out.x = this.x * inv;
    out.y = this.y * inv;

    return out as this;
  }

  /**
   * Rescales this vector so its magnitude equals `length`
   *
   * Zero-magnitude vectors are left unchanged.
   * @param length - The target magnitude
   * @param out - The target to write the result into, defaults to this vector
   * @returns The vector the result was written into
   */
  public setLength(length: number, out: PointLike = this): this {
    const len = Math.sqrt(this.x * this.x + this.y * this.y) || 1;
    const inv = length / len;
    out.x = this.x * inv;
    out.y = this.y * inv;

    return out as this;
  }

  /**
   * Computes the magnitude (length) of this vector
   * @returns The magnitude
   */
  public magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  /**
   * Computes the squared magnitude of this vector
   *
   * Cheaper than `magnitude()` for length comparisons.
   * @returns The squared magnitude
   */
  public magnitudeSquared(): number {
    return this.x * this.x + this.y * this.y;
  }

  /**
   * Computes the Euclidean distance from this vector to `v`
   * @param v - The point to measure to
   * @returns The distance
   */
  public distanceTo(v: PointData): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;

    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Computes the squared Euclidean distance from this vector to `v`
   * @param v - The point to measure to
   * @returns The squared distance
   */
  public distanceToSquared(v: PointData): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;

    return dx * dx + dy * dy;
  }

  /**
   * Computes the dot product of this vector and `v`
   * @param v - The other point
   * @returns The dot product
   */
  public dot(v: PointData): number {
    return this.x * v.x + this.y * v.y;
  }

  /**
   * Computes the angle of this vector with respect to the positive x-axis
   * @returns The angle in radians
   */
  public angle(): number {
    return Math.atan2(this.y, this.x);
  }

  /**
   * Computes the z-component of the 3D cross product of `this` and `v` (treating both as having
   * `z = 0`)
   * @param v - The other point
   * @returns The z-component of the cross product
   */
  public cross(v: PointData): number {
    return this.x * v.y - this.y * v.x;
  }

  /**
   * Applies a {@link Matrix3} (column-major) to this vector
   * @param m - The matrix to apply
   * @param out - The target to write the result into, defaults to this vector
   * @returns The vector the result was written into
   */
  public applyMatrix3(m: Matrix3, out: PointLike = this): this {
    const x = this.x;
    const y = this.y;
    const e = m.elements;
    out.x = e[0] * x + e[3] * y + e[6];
    out.y = e[1] * x + e[4] * y + e[7];

    return out as this;
  }

  /**
   * Rotates this vector around the origin by `angle` radians
   * @param angle - The rotation angle in radians
   * @param out - The target to write the result into, defaults to this vector
   * @returns The vector the result was written into
   */
  public rotate(angle: number, out: PointLike = this): this {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const x = this.x;
    const y = this.y;
    out.x = x * c - y * s;
    out.y = x * s + y * c;

    return out as this;
  }

  /**
   * Rotates this vector around `center` by `angle` radians
   * @param center - The point to rotate around
   * @param angle - The rotation angle in radians
   * @param out - The target to write the result into, defaults to this vector
   * @returns The vector the result was written into
   */
  public rotateAround(center: PointData, angle: number, out: PointLike = this): this {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const dx = this.x - center.x;
    const dy = this.y - center.y;
    out.x = dx * c - dy * s + center.x;
    out.y = dx * s + dy * c + center.y;

    return out as this;
  }
}

const _shared = new Vector2();
