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
 * A {@link Vector3} that tells an observer when it changes
 *
 * A node's {@link Container3D#position | position}, {@link Container3D#scale | scale},
 * {@link Container3D#rotation | rotation} and {@link Container3D#origin | origin} use this class,
 * so a change to one updates the node. It has the same methods as {@link Vector3}. Each in-place method
 * notifies the observer at most once, and not at all when no component changed. Given an `out`
 * target, a method writes there and leaves this point and its observer alone.
 * @example
 * ```ts
 * app.ticker.add((ticker) => {
 *   player.position.addScaledVector(velocity, ticker.deltaMS / 1000);
 * });
 * ```
 * @category maths
 * @standard
 */
export class ObservableVector3 implements PointLike3D {
  /** @ignore */
  public _x = 0;
  /** @ignore */
  public _y = 0;
  /** @ignore */
  public _z = 0;

  private readonly _observer: Observer<ObservableVector3>;

  /**
   * The x component; assigning a different value notifies the observer
   * @example
   * ```ts
   * player.position.x += strafeSpeed * dt;
   * ```
   */
  get x(): number {
    return this._x;
  }

  /**
   * Sets the x component
   * @param value - The new x
   */
  set x(value: number) {
    if (this._x !== value) {
      this._x = value;
      this._observer._onUpdate(this);
    }
  }

  /**
   * The y component; assigning a different value notifies the observer
   * @example
   * ```ts
   * if (player.position.y < killPlaneY) respawn(player);
   * ```
   */
  get y(): number {
    return this._y;
  }

  /**
   * Sets the y component
   * @param value - The new y
   */
  set y(value: number) {
    if (this._y !== value) {
      this._y = value;
      this._observer._onUpdate(this);
    }
  }

  /**
   * The z component; assigning a different value notifies the observer
   * @example
   * ```ts
   * crate.position.z = -10;
   * ```
   */
  get z(): number {
    return this._z;
  }

  /**
   * Sets the z component
   * @param value - The new z
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
   * @param x - The x component
   * @param y - The y component
   * @param z - The z component
   */
  constructor(observer: Observer<ObservableVector3>, x = 0, y = 0, z = 0) {
    this._x = x;
    this._y = y;
    this._z = z;
    this._observer = observer;
  }

  /**
   * Sets the x, y and z components
   * @example
   * ```ts
   * crate.position.set(0, 1, -5);
   * crate.scale.set(2);
   * ```
   * @param x - The x component
   * @param y - The y component, defaults to `x`
   * @param z - The z component, defaults to `x`
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
   * @example
   * ```ts
   * loot.position.copyFrom(enemy.position);
   * ```
   * @param p - The point to copy from
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
   * @example
   * ```ts
   * player.position.copyTo(lastCheckpoint);
   * ```
   * @param p - The point to copy into
   * @returns The given point with values updated
   */
  public copyTo<T extends PointLike3D>(p: T): T {
    p.set(this._x, this._y, this._z);

    return p;
  }

  /**
   * Checks whether `x`, `y` and `z` all match `p` exactly, with no tolerance
   * @example
   * ```ts
   * if (!player.position.equals(lastSentPosition)) sendPosition(player.position);
   * ```
   * @param p - The point to compare against
   */
  public equals(p: PointData3D): boolean {
    return p.x === this._x && p.y === this._y && p.z === this._z;
  }

  /**
   * Creates a copy of this point that notifies `observer`, or this point's own observer when left out
   *
   * A clone of a node's `position` that keeps the node as its observer marks the node's transform for
   * an update whenever the clone changes, though the node hasn't moved. For a plain copy, use
   * `new Vector3().copyFrom(node.position)`.
   * @param observer - Optional observer for the clone
   */
  // oxlint-disable-next-line pixi3d/require-standard-example -- observer-linked copy; plain copies use Vector3#copyFrom
  public clone(observer?: Observer<ObservableVector3>): ObservableVector3 {
    return new ObservableVector3(observer ?? this._observer, this._x, this._y, this._z);
  }

  /**
   * Returns a readable string representation of this point
   * @example
   * ```ts
   * console.log(player.position.toString());
   * ```
   */
  public toString(): string {
    return `[pixi-3d/math:ObservableVector3 x=${this._x} y=${this._y} z=${this._z}]`;
  }

  /**
   * Reads `x`, `y`, `z` from `array` starting at `offset`
   * @example
   * ```ts
   * crates.forEach((crate: Container3D, i: number) => crate.position.fromArray(savedPositions, i * 3));
   * ```
   * @param array - The array to read from
   * @param offset - The index of the first component
   */
  public fromArray(array: number[] | Float32Array, offset = 0): this {
    return this.set(array[offset], array[offset + 1], array[offset + 2]);
  }

  /**
   * Writes this point's values into `array` starting at `offset`
   *
   * Allocates a new array when one is not supplied.
   * @example
   * ```ts
   * crates.forEach((crate: Container3D, i: number) => crate.position.toArray(savedPositions, i * 3));
   * ```
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
   * @example
   * ```ts
   * rider.position.add(platformMovement);
   * player.position.add(cameraOffset, cameraTarget);
   * ```
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
   * @example
   * ```ts
   * target.position.subtract(turret.position, aimDirection);
   * ```
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
   * Multiplies each component of this point by the matching component of `v`
   * @example
   * ```ts
   * jelly.scale.multiply({ x: 1.2, y: 0.8, z: 1.2 });
   * ```
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
   * @example
   * ```ts
   * balloon.scale.multiplyScalar(1 + inflateRate * dt);
   * ```
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
   * Divides each component of this point by the matching component of `v`
   * @example
   * ```ts
   * player.position.divide(cellSize, cell);
   * const column = Math.floor(cell.x);
   * ```
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
   * @example
   * ```ts
   * pickup.scale.divideScalar(2);
   * ```
   * @param s - The scalar to divide by
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  public divideScalar(s: number, out: PointLike3D = this): this {
    return this.multiplyScalar(1 / s, out);
  }

  /**
   * Adds `v * s` to this point, such as a velocity times the frame time
   * @example
   * ```ts
   * player.position.addScaledVector(velocity, dt);
   * ```
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
   * Negates each component of this point, mirroring it through the origin
   * @example
   * ```ts
   * reflection.position.copyFrom(player.position).negate();
   * ```
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
   * Sets each component to the smaller of this point's and `v`'s
   * @example
   * ```ts
   * player.position.min({ x: Infinity, y: ceilingHeight, z: Infinity });
   * ```
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
   * Sets each component to the larger of this point's and `v`'s
   * @example
   * ```ts
   * player.position.max({ x: -Infinity, y: floorHeight, z: -Infinity });
   * ```
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
   * Clamps each component of this point between the matching components of `min` and `max`
   *
   * Assumes `min <= max` componentwise.
   * @example
   * ```ts
   * player.position.clamp(arenaMin, arenaMax);
   * ```
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
   * Scales this point to unit length, keeping its direction from the origin
   *
   * A zero point stays zero.
   * @example
   * ```ts
   * player.position.normalize(surfaceUp);
   * ```
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
   * Scales this point so its distance from the origin equals `length`, keeping its direction
   *
   * A zero point stays zero.
   * @example
   * ```ts
   * satellite.position.setLength(orbitRadius);
   * ```
   * @param length - The target length
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
   * Computes the length of this point, its distance from the origin
   * @example
   * ```ts
   * const altitude = player.position.magnitude() - planetRadius;
   * ```
   */
  public magnitude(): number {
    return Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z);
  }

  /**
   * Computes the squared length of this point
   *
   * Cheaper than {@link ObservableVector3#magnitude}, since it skips the square root, and enough to
   * compare lengths.
   * @example
   * ```ts
   * if (ball.position.magnitudeSquared() > arenaRadius * arenaRadius) resetBall();
   * ```
   */
  public magnitudeSquared(): number {
    return this._x * this._x + this._y * this._y + this._z * this._z;
  }

  /**
   * Computes the distance from this point to `v`
   * @example
   * ```ts
   * const distanceToExit = player.position.distanceTo(exit.position);
   * ```
   * @param v - The point to measure to
   */
  public distanceTo(v: PointData3D): number {
    return Math.sqrt(this.distanceToSquared(v));
  }

  /**
   * Computes the squared distance from this point to `v`
   *
   * Cheaper than {@link ObservableVector3#distanceTo} and enough to compare distances.
   * @example
   * ```ts
   * if (player.position.distanceToSquared(coin.position) < pickupRadius * pickupRadius) collect(coin);
   * ```
   * @param v - The point to measure to
   */
  public distanceToSquared(v: PointData3D): number {
    const dx = this._x - v.x;
    const dy = this._y - v.y;
    const dz = this._z - v.z;

    return dx * dx + dy * dy + dz * dz;
  }

  /**
   * Computes the dot product of this point and `v`
   * @example
   * ```ts
   * const distanceAlongTrack = car.position.dot(trackDirection);
   * ```
   * @param v - The other point
   */
  public dot(v: PointData3D): number {
    return this._x * v.x + this._y * v.y + this._z * v.z;
  }

  /**
   * Computes the angle between this point and `v`, both seen from the origin
   *
   * Returns π/2 when either has zero length.
   * @example
   * ```ts
   * const distanceOverSurface = player.position.angleTo(base.position) * planetRadius;
   * ```
   * @param v - The other point
   * @returns The angle in radians, from 0 to π
   */
  public angleTo(v: PointData3D): number {
    const denominator = Math.sqrt(this.magnitudeSquared() * (v.x * v.x + v.y * v.y + v.z * v.z));
    if (denominator === 0) return Math.PI / 2;
    const theta = this.dot(v) / denominator;

    return Math.acos(clamp(theta, -1, 1));
  }

  /**
   * Computes the cross product `this × v`, a vector at right angles to both
   * @example
   * ```ts
   * player.position.cross(planetAxis, travelDirection).normalize();
   * ```
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
   * Multiplies this point by the 3x3 matrix `m`
   * @example
   * ```ts
   * satellite.position.applyMatrix3(orbitTilt);
   * ```
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
   * Transforms this point by `m`, translation included, then divides by the resulting `w`
   *
   * {@link Vector3#applyMatrix4} explains when the divide matters.
   * @example
   * ```ts
   * enemy.position.applyMatrix4(camera.viewProjection, ndc);
   * const onScreen = Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && Math.abs(ndc.z) <= 1;
   * ```
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
   * Transforms this point by `m`, translation included, without the divide
   * {@link ObservableVector3#applyMatrix4} does
   *
   * Cheaper, and correct for any transform that doesn't project, such as a node's world transform.
   * @example
   * ```ts
   * muzzle.position.applyAffineMatrix4(gun.worldTransform, muzzleWorldPosition);
   * ```
   * @param m - The matrix to apply
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
   * Rotates this point around the origin by the unit {@link Quaternion} `q`
   * @example
   * ```ts
   * chaseCamera.position.copyFrom(followOffset).applyQuaternion(car.quaternion).add(car.position);
   * ```
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
   * Turns this point, read as a direction, by the rotation and scale in `m`, ignoring its translation,
   * then normalizes it
   * @param m - The matrix whose rotation to apply
   * @param out - The target to write the result into, defaults to this point
   * @returns The point the result was written into
   */
  // oxlint-disable-next-line pixi3d/require-standard-example -- direction math; see Vector3#transformDirection
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
   * Sets this point to the position the {@link Spherical} coordinate `s` describes
   *
   * {@link Vector3#setFromSpherical} describes the angles.
   * @example
   * ```ts
   * orbit.theta += turnSpeed * dt;
   * camera.position.setFromSpherical(orbit).add(target.position);
   * ```
   * @param s - The spherical coordinate to convert
   */
  public setFromSpherical(s: Spherical): this {
    const sinPhiRadius = Math.sin(s.phi) * s.radius;

    return this.set(sinPhiRadius * Math.sin(s.theta), Math.cos(s.phi) * s.radius, sinPhiRadius * Math.cos(s.theta));
  }

  /**
   * Sets this point to the position the {@link Cylindrical} coordinate `c` describes
   *
   * {@link Vector3#setFromCylindrical} describes the angle and height.
   * @example
   * ```ts
   * const slot = new Cylindrical(towerRadius, 0, 2);
   *
   * torches.forEach((torch: Mesh3D, i: number) => {
   *   slot.theta = (i / torches.length) * Math.PI * 2;
   *   torch.position.setFromCylindrical(slot);
   * });
   * ```
   * @param c - The cylindrical coordinate to convert
   */
  public setFromCylindrical(c: Cylindrical): this {
    return this.set(c.radius * Math.sin(c.theta), c.y, c.radius * Math.cos(c.theta));
  }

  /**
   * Reads the first three values of column `index` of `m` into this point
   *
   * In a transform, column 3 is the translation and columns 0 to 2 are the X, Y and Z axes, scaled.
   * @example
   * ```ts
   * marker.position.setFromMatrixColumn(target.worldTransform, 3);
   * ```
   * @param m - The matrix to read from
   * @param index - The column index, `0` to `3`
   */
  public setFromMatrixColumn(m: Matrix4, index: number): this {
    return this.fromArray(m.elements, index * 4);
  }
}
