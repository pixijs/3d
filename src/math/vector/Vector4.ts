import type { Matrix4 } from '../matrix/Matrix4';
import { clamp } from '../utils/clamp';
import type { PointData4D } from './PointData4D';
import type { PointLike4D } from './PointLike4D';

/**
 * A four-component vector, such as a position with a `w`, an RGBA colour or a plane equation
 *
 * Math methods work on all four components, change the vector they're called on and return it; pass
 * an `out` point last to write the result there instead. Where a method takes a point, any
 * {@link PointData4D} works, such as a plain `{ x, y, z, w }` object.
 * @example
 * ```ts
 * const clip = new Vector4(point.x, point.y, point.z, 1).applyMatrix4(camera.viewProjection);
 *
 * if (clip.w > 0) clip.divideScalar(clip.w);
 * ```
 * @category maths
 * @standard
 */
export class Vector4 implements PointLike4D {
  /**
   * The x component
   * @example
   * ```ts
   * const screenX = clip.x / clip.w;
   * ```
   */
  public x = 0;
  /**
   * The y component
   * @example
   * ```ts
   * const screenY = clip.y / clip.w;
   * ```
   */
  public y = 0;
  /**
   * The z component
   * @example
   * ```ts
   * const depth = clip.z / clip.w;
   * ```
   */
  public z = 0;
  /**
   * The fourth component, by convention `1` for a position and `0` for a direction
   * @example
   * ```ts
   * const behindCamera = clip.w <= 0;
   * ```
   */
  public w = 1;

  /**
   * A static `Vector4` reset to `(0, 0, 0, 1)` on every access, for a result used straight away
   *
   * > [!IMPORTANT] This vector is shared and temporary. Do not store references to it.
   * @example
   * ```ts
   * const clipW = Vector4.shared.set(point.x, point.y, point.z).applyMatrix4(camera.viewProjection).w;
   * ```
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
   * @param x - The x component
   * @param y - The y component
   * @param z - The z component
   * @param w - The fourth component, defaults to `1`
   */
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  /**
   * Sets all four components
   * @example
   * ```ts
   * position.set(0, 2, -5);
   * direction.set(0, 0, -1, 0);
   * ```
   * @param x - The x component
   * @param y - The y component, defaults to `x`
   * @param z - The z component, defaults to `x`
   * @param w - The fourth component, defaults to `1`, not to `x`
   */
  public set(x = 0, y = x, z = x, w = 1): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;

    return this;
  }

  /**
   * Copies x, y, z, w from the given point into this vector
   * @example
   * ```ts
   * previousClip.copyFrom(clip);
   * ```
   * @param p - The point to copy from
   */
  public copyFrom(p: PointData4D): this {
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;
    this.w = p.w;

    return this;
  }

  /**
   * Copies this vector's x, y, z, w into the given point
   * @example
   * ```ts
   * clip.copyTo(previousClip);
   * ```
   * @param p - The point to copy into
   * @returns The given point
   */
  public copyTo<T extends PointLike4D>(p: T): T {
    p.set(this.x, this.y, this.z, this.w);

    return p;
  }

  /**
   * Checks whether `x`, `y`, `z` and `w` all match `p` exactly, with no tolerance
   * @example
   * ```ts
   * if (!tint.equals(lastTint)) applyTint(tint);
   * ```
   * @param p - The point to compare against
   */
  public equals(p: PointData4D): boolean {
    return p.x === this.x && p.y === this.y && p.z === this.z && p.w === this.w;
  }

  /**
   * Creates a copy of this vector
   * @example
   * ```ts
   * const startColor = color.clone();
   * ```
   */
  public clone(): Vector4 {
    return new Vector4(this.x, this.y, this.z, this.w);
  }

  /**
   * Builds a debug string for this vector
   * @example
   * ```ts
   * console.log(clip.toString());
   * ```
   * @returns A string of the form `[pixi-3d/math:Vector4 x=... y=... z=... w=...]`
   */
  public toString(): string {
    return `[pixi-3d/math:Vector4 x=${this.x} y=${this.y} z=${this.z} w=${this.w}]`;
  }

  /**
   * Reads `x`, `y`, `z`, `w` from `array` starting at `offset`
   * @example
   * ```ts
   * tangent.fromArray(tangents, vertexIndex * 4);
   * ```
   * @param array - The source array
   * @param offset - Index of the first component in `array`
   */
  public fromArray(array: number[] | Float32Array, offset = 0): this {
    this.x = array[offset];
    this.y = array[offset + 1];
    this.z = array[offset + 2];
    this.w = array[offset + 3];

    return this;
  }

  /**
   * Writes this vector's values into `array` starting at `offset`
   * @example
   * ```ts
   * color.toArray(instanceColors, instanceIndex * 4);
   * ```
   * @param array - The destination array; a new one is allocated when omitted
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
   * Adds `v` to this vector
   * @example
   * ```ts
   * baseColor.add(hitFlash, displayColor);
   * ```
   * @param v - The point to add
   * @param out - The target to write the result into, defaults to this vector
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
   * Subtracts `v` from this vector
   * @example
   * ```ts
   * targetColor.subtract(color, colorStep);
   * ```
   * @param v - The point to subtract
   * @param out - The target to write the result into, defaults to this vector
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
   * Multiplies each component of this vector by the matching component of `v`
   * @example
   * ```ts
   * baseColor.multiply(teamTint, displayColor);
   * ```
   * @param v - The point to multiply by
   * @param out - The target to write the result into, defaults to this vector
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
   * Multiplies each component of this vector by the scalar `s`
   * @example
   * ```ts
   * color.multiplyScalar(brightness);
   * ```
   * @param s - The scalar to multiply by
   * @param out - The target to write the result into, defaults to this vector
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
   * Divides each component of this vector by the matching component of `v`
   * @example
   * ```ts
   * hdrColor.divide(whitePoint, displayColor);
   * ```
   * @param v - The point to divide by
   * @param out - The target to write the result into, defaults to this vector
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
   * Divides each component of this vector by the scalar `s`
   * @example
   * ```ts
   * clip.divideScalar(clip.w);
   * ```
   * @param s - The scalar to divide by
   * @param out - The target to write the result into, defaults to this vector
   * @returns The `out` point
   */
  public divideScalar(s: number, out: PointLike4D = this): this {
    return this.multiplyScalar(1 / s, out);
  }

  /**
   * Adds `v * s` to this vector
   * @example
   * ```ts
   * color.addScaledVector(colorStep, fadeSpeed * dt);
   * ```
   * @param v - The point to scale and add
   * @param s - The scalar applied to `v`
   * @param out - The target to write the result into, defaults to this vector
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
   * Negates each component of this vector
   * @example
   * ```ts
   * clipPlane.negate();
   * ```
   * @param out - The target to write the result into, defaults to this vector
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
   * Sets each component to the smaller of this vector's and `v`'s
   * @example
   * ```ts
   * color.min({ x: 1, y: 1, z: 1, w: 1 });
   * ```
   * @param v - The point to compare against
   * @param out - The target to write the result into, defaults to this vector
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
   * Sets each component to the larger of this vector's and `v`'s
   * @example
   * ```ts
   * color.max({ x: 0, y: 0, z: 0, w: 0 });
   * ```
   * @param v - The point to compare against
   * @param out - The target to write the result into, defaults to this vector
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
   * Clamps each component of this vector between the matching components of `min` and `max`
   *
   * Assumes `min <= max` componentwise.
   * @example
   * ```ts
   * hdrColor.clamp({ x: 0, y: 0, z: 0, w: 0 }, { x: 1, y: 1, z: 1, w: 1 }, displayColor);
   * ```
   * @param min - The lower bound per component
   * @param max - The upper bound per component
   * @param out - The target to write the result into, defaults to this vector
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
   * Scales this vector to unit length across all four components
   *
   * A zero vector stays zero.
   * @param out - The target to write the result into, defaults to this vector
   * @returns The `out` point
   */
  // oxlint-disable-next-line pixi3d/require-standard-example -- same operation as on Vector3
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
   * Scales this vector so its length across all four components equals `length`
   *
   * A zero vector stays zero.
   * @param length - The target length
   * @param out - The target to write the result into, defaults to this vector
   * @returns The `out` point
   */
  // oxlint-disable-next-line pixi3d/require-standard-example -- same operation as on Vector3
  public setLength(length: number, out: PointLike4D = this): this {
    const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w) || 1;
    const inv = length / len;
    out.x = this.x * inv;
    out.y = this.y * inv;
    out.z = this.z * inv;
    out.w = this.w * inv;

    return out as this;
  }

  /** Computes the length of this vector across all four components */
  // oxlint-disable-next-line pixi3d/require-standard-example -- same operation as on Vector3
  public magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
  }

  /**
   * Computes the squared length of this vector
   *
   * Cheaper than {@link Vector4#magnitude}, since it skips the square root, and enough to compare
   * lengths.
   * @example
   * ```ts
   * const moving = velocity.magnitudeSquared() > 0.0001;
   * ```
   */
  public magnitudeSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }

  /**
   * Computes the distance from this vector to `v` across all four components
   * @example
   * ```ts
   * const colorDifference = pixel.distanceTo(keyColor);
   * ```
   * @param v - The point to measure to
   */
  public distanceTo(v: PointData4D): number {
    return Math.sqrt(this.distanceToSquared(v));
  }

  /**
   * Computes the squared distance from this vector to `v`
   *
   * Cheaper than {@link Vector4#distanceTo} and enough to compare distances.
   * @example
   * ```ts
   * if (pixel.distanceToSquared(keyColor) < tolerance * tolerance) pixel.w = 0;
   * ```
   * @param v - The point to measure to
   */
  public distanceToSquared(v: PointData4D): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    const dw = this.w - v.w;

    return dx * dx + dy * dy + dz * dz + dw * dw;
  }

  /**
   * Computes the dot product of this vector and `v`
   *
   * With a plane `(nx, ny, nz, d)` whose normal has unit length and a point whose `w` is 1, it's the
   * point's signed distance from the plane.
   * @example
   * ```ts
   * const inFront = clipPlane.dot(point) > 0;
   * ```
   * @param v - The other vector
   */
  public dot(v: PointData4D): number {
    return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;
  }

  /**
   * Computes the angle between this vector and `v` across all four components
   *
   * Returns π/2 when either vector has zero length.
   * @param v - The other vector
   * @returns The angle in radians, from 0 to π
   */
  // oxlint-disable-next-line pixi3d/require-standard-example -- same operation as on Vector3
  public angleTo(v: PointData4D): number {
    const denominator = Math.sqrt(this.magnitudeSquared() * (v.x * v.x + v.y * v.y + v.z * v.z + v.w * v.w));
    if (denominator === 0) return Math.PI / 2;
    const theta = this.dot(v) / denominator;

    return Math.acos(clamp(theta, -1, 1));
  }

  /**
   * Multiplies this vector by `m`, `w` included, without a divide
   *
   * A position (`w = 1`) picks up the matrix's translation and a direction (`w = 0`) doesn't. With a
   * projection matrix the result is in clip space; divide by `w` to get x and y from -1 to 1 across
   * the view.
   * @example
   * ```ts
   * clip.set(point.x, point.y, point.z).applyMatrix4(camera.viewProjection);
   * ```
   * @param m - The matrix to apply
   * @param out - The target to write the result into, defaults to this vector
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
