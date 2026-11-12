import type { PointData, PointLike } from 'pixi.js';

import type { Matrix3 } from '../matrix/Matrix3';
import { clamp } from '../utils/clamp';

/**
 * A point or direction in 2D, such as a UV coordinate, a screen position or stick input
 *
 * Math methods change the vector they're called on and return it, so calls chain. Pass an `out`
 * point as the last argument to write the result there instead and leave this one as it is;
 * {@link Vector3} explains why to reuse `out` points in code that runs every frame. Where a method
 * takes a point, any pixi.js `PointData` works, such as a pixi `Point` or a plain `{ x, y }` object.
 * @example
 * ```ts
 * const input = new Vector2(stick.x, stick.y);
 *
 * if (input.magnitudeSquared() > 1) input.normalize();
 * player.position.x += input.x * speed * dt;
 * player.position.z += input.y * speed * dt;
 * ```
 * @category maths
 * @standard
 */
export class Vector2 implements PointLike {
  /**
   * The x component
   * @example
   * ```ts
   * cursor.x = event.global.x;
   * ```
   */
  public x = 0;
  /**
   * The y component
   * @example
   * ```ts
   * cursor.y = event.global.y;
   * ```
   */
  public y = 0;

  /**
   * A static `Vector2` reset to `(0, 0)` on every access, for a result used straight away
   *
   * > [!IMPORTANT] This vector is shared and temporary. Do not store references to it.
   * @example
   * ```ts
   * const dragged = Vector2.shared.copyFrom(event.global).distanceTo(dragStart) > dragThreshold;
   * ```
   */
  static get shared(): Vector2 {
    _shared.x = 0;
    _shared.y = 0;

    return _shared;
  }

  /**
   * Creates a new `Vector2`
   * @param x - The x component
   * @param y - The y component
   */
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  /**
   * Sets the x and y components
   * @example
   * ```ts
   * uvOffset.set(0.5, 0);
   * tiling.set(4); // (4, 4)
   * ```
   * @param x - The x component
   * @param y - The y component, defaults to `x`
   */
  public set(x = 0, y = x): this {
    this.x = x;
    this.y = y;

    return this;
  }

  /**
   * Copies x, y from the given point into this vector
   * @example
   * ```ts
   * dragStart.copyFrom(event.global);
   * ```
   * @param p - The point to copy from
   */
  public copyFrom(p: PointData): this {
    this.x = p.x;
    this.y = p.y;

    return this;
  }

  /**
   * Copies this vector's x, y into the given point
   * @example
   * ```ts
   * cursor.copyTo(crosshair.position);
   * ```
   * @param p - The point to copy into
   * @returns The given point with values updated
   */
  public copyTo<T extends PointLike>(p: T): T {
    p.set(this.x, this.y);

    return p;
  }

  /**
   * Checks whether `x` and `y` both match `p` exactly, with no tolerance
   * @example
   * ```ts
   * if (!cursor.equals(lastCursor)) updateHover(cursor);
   * ```
   * @param p - The point to compare against
   */
  public equals(p: PointData): boolean {
    return p.x === this.x && p.y === this.y;
  }

  /**
   * Creates a copy of this vector
   * @example
   * ```ts
   * const dragStart = cursor.clone();
   * ```
   */
  public clone(): Vector2 {
    return new Vector2(this.x, this.y);
  }

  /**
   * Returns a readable string representation of this vector
   * @example
   * ```ts
   * console.log(cursor.toString());
   * ```
   */
  public toString(): string {
    return `[@pixi/3d/math:Vector2 x=${this.x} y=${this.y}]`;
  }

  /**
   * Reads `x`, `y` from `array` starting at `offset`
   * @example
   * ```ts
   * uv.fromArray(uvs, vertexIndex * 2);
   * ```
   * @param array - The array to read from
   * @param offset - The index of the first component
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
   * @example
   * ```ts
   * uv.toArray(uvs, vertexIndex * 2);
   * ```
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
   * @example
   * ```ts
   * scroll.add(scrollStep);
   * anchor.add(labelOffset, labelPosition);
   * ```
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
   * @example
   * ```ts
   * cursor.subtract(dragStart, dragDelta);
   * ```
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
   * Multiplies each component of this vector by the matching component of `v`
   * @example
   * ```ts
   * uv.multiply(tiling);
   * ```
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
   * @example
   * ```ts
   * input.multiplyScalar(speed * dt, step);
   * ```
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
   * Divides each component of this vector by the matching component of `v`
   * @example
   * ```ts
   * pixel.divide({ x: texture.width, y: texture.height }, uv);
   * ```
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
   * @example
   * ```ts
   * thumbOffset.divideScalar(stickRadius, stick);
   * ```
   * @param s - The scalar to divide by
   * @param out - The target to write the result into, defaults to this vector
   * @returns The vector the result was written into
   */
  public divideScalar(s: number, out: PointLike = this): this {
    return this.multiplyScalar(1 / s, out);
  }

  /**
   * Adds `v * s` to this vector, such as a speed times the frame time
   * @example
   * ```ts
   * uvOffset.addScaledVector(scrollSpeed, dt);
   * ```
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
   * Negates each component of this vector, reversing its direction
   * @example
   * ```ts
   * hitDirection.negate(knockback);
   * ```
   * @param out - The target to write the result into, defaults to this vector
   * @returns The vector the result was written into
   */
  public negate(out: PointLike = this): this {
    out.x = -this.x;
    out.y = -this.y;

    return out as this;
  }

  /**
   * Sets each component to the smaller of this vector's and `v`'s
   * @example
   * ```ts
   * selectionMin.min(cursor);
   * ```
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
   * Sets each component to the larger of this vector's and `v`'s
   * @example
   * ```ts
   * selectionMax.max(cursor);
   * ```
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
   * Clamps each component of this vector between the matching components of `min` and `max`
   *
   * Assumes `min <= max` componentwise.
   * @example
   * ```ts
   * cursor.clamp(minimapMin, minimapMax, minimapMarker);
   * ```
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
   * Scales this vector to unit length, keeping its direction
   *
   * A zero vector stays zero.
   * @example
   * ```ts
   * input.normalize();
   * ```
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
   * Scales this vector so its length equals `length`, keeping its direction
   *
   * A zero vector stays zero.
   * @example
   * ```ts
   * dashDirection.setLength(dashDistance, dashOffset);
   * ```
   * @param length - The target length
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
   * Computes the length of this vector
   * @example
   * ```ts
   * const stickTilt = stick.magnitude();
   * ```
   */
  public magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  /**
   * Computes the squared length of this vector
   *
   * Cheaper than {@link Vector2#magnitude}, since it skips the square root, and enough to compare
   * lengths.
   * @example
   * ```ts
   * if (stick.magnitudeSquared() < deadZone * deadZone) stick.set(0);
   * ```
   */
  public magnitudeSquared(): number {
    return this.x * this.x + this.y * this.y;
  }

  /**
   * Computes the distance from this point to `v`
   * @example
   * ```ts
   * if (cursor.distanceTo(dragStart) > dragThreshold) startDrag();
   * ```
   * @param v - The point to measure to
   */
  public distanceTo(v: PointData): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;

    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Computes the squared distance from this point to `v`
   *
   * Cheaper than {@link Vector2#distanceTo} and enough to compare distances.
   * @example
   * ```ts
   * const hovered = cursor.distanceToSquared(button.center) < button.radius * button.radius;
   * ```
   * @param v - The point to measure to
   */
  public distanceToSquared(v: PointData): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;

    return dx * dx + dy * dy;
  }

  /**
   * Computes the dot product of this vector and `v`
   *
   * For unit vectors it's the cosine of the angle between them: 1 when they point the same way, 0 at
   * right angles and -1 when opposite.
   * @example
   * ```ts
   * const targetIsAhead = heading.dot(toTarget) > 0;
   * ```
   * @param v - The other vector
   */
  public dot(v: PointData): number {
    return this.x * v.x + this.y * v.y;
  }

  /**
   * Computes the angle from the +x axis to this vector, turning toward +y
   * @example
   * ```ts
   * cursor.subtract(arrow.position, toCursor);
   * arrow.rotation = toCursor.angle();
   * ```
   * @returns The angle in radians, from -π to π
   */
  public angle(): number {
    return Math.atan2(this.y, this.x);
  }

  /**
   * Computes `x * v.y - y * v.x`, the z of the 3D cross product with both vectors at `z = 0`
   *
   * The sign says which way to turn from this vector to `v`: positive is the way +x turns toward +y
   * (counter-clockwise when y points up, clockwise on a pixi screen, where y points down), negative
   * the other way, and zero when they are parallel.
   * @example
   * ```ts
   * const turnDirection = Math.sign(heading.cross(toTarget));
   * ```
   * @param v - The other vector
   */
  public cross(v: PointData): number {
    return this.x * v.y - this.y * v.x;
  }

  /**
   * Transforms this point by `m` as a 2D transform: rotation, scale and translation
   *
   * The matrix's bottom row is not used, so there is no divide.
   * @example
   * ```ts
   * const uvTransform = new Matrix3().setUvTransform(0.25, 0, 2, 2, 0, 0.5, 0.5);
   *
   * uv.applyMatrix3(uvTransform);
   * ```
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
   * Rotates this vector around the origin by `angle` radians, turning +x toward +y
   * @example
   * ```ts
   * stick.rotate(-cameraYaw, moveDirection);
   * ```
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
   * Rotates this point around `center` by `angle` radians, turning +x toward +y
   * @example
   * ```ts
   * moon.rotateAround(planet, orbitSpeed * dt);
   * ```
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
