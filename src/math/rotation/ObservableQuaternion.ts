import type { Observer } from 'pixi.js';

import type { Matrix4 } from '../matrix/Matrix4';
import { clamp } from '../utils/clamp';
import type { PointData3D } from '../vector/PointData3D';
import { multiplyQuaternionData, Quaternion } from './Quaternion';
import type { QuaternionData } from './Quaternion';

/**
 * A {@link Quaternion} that tells an observer when it changes
 *
 * It is the type of a node's {@link Container3D#quaternion | quaternion}: a change is how the node
 * learns to rebuild its transform. It has the same methods as {@link Quaternion}. Each in-place method
 * notifies the observer at most once, and not at all when no component changed. Given an `out`
 * target, a method writes there and leaves this quaternion and its observer alone.
 * @example
 * ```ts
 * const up = { x: 0, y: 1, z: 0 };
 *
 * app.ticker.add((ticker) => {
 *   coin.quaternion.setFromAxisAngle(up, (ticker.lastTime / 1000) * spinSpeed);
 * });
 * ```
 * @see {@link Quaternion} For the non-observable counterpart
 * @see {@link Observer} For the observer interface
 * @category maths
 * @standard
 */
export class ObservableQuaternion implements QuaternionData {
  /** @ignore */
  public _x = 0;
  /** @ignore */
  public _y = 0;
  /** @ignore */
  public _z = 0;
  /** @ignore */
  public _w = 0;

  /** Object whose `_onUpdate` callback is invoked when this quaternion changes */
  private readonly _observer: Observer<ObservableQuaternion>;

  /**
   * The x component; assigning a different value notifies the observer
   * @example
   * ```ts
   * const axisX = node.quaternion.x / Math.sqrt(1 - node.quaternion.w ** 2);
   * ```
   */
  get x(): number {
    return this._x;
  }

  /**
   * Sets the x component
   * @param value - New x component
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
   * const axisY = node.quaternion.y / Math.sqrt(1 - node.quaternion.w ** 2);
   * ```
   */
  get y(): number {
    return this._y;
  }

  /**
   * Sets the y component
   * @param value - New y component
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
   * const axisZ = node.quaternion.z / Math.sqrt(1 - node.quaternion.w ** 2);
   * ```
   */
  get z(): number {
    return this._z;
  }

  /**
   * Sets the z component
   * @param value - New z component
   */
  set z(value: number) {
    if (this._z !== value) {
      this._z = value;
      this._observer._onUpdate(this);
    }
  }

  /**
   * The w component; assigning a different value notifies the observer
   * @example
   * ```ts
   * const angle = 2 * Math.acos(node.quaternion.w);
   * ```
   */
  get w(): number {
    return this._w;
  }

  /**
   * Sets the w component
   * @param value - New w component
   */
  set w(value: number) {
    if (this._w !== value) {
      this._w = value;
      this._observer._onUpdate(this);
    }
  }

  /**
   * Creates a new `ObservableQuaternion`, defaulting to identity `(0, 0, 0, 1)`
   * @param observer - Observer notified when any component changes
   * @param x - The x component
   * @param y - The y component
   * @param z - The z component
   * @param w - The w component
   */
  constructor(observer: Observer<ObservableQuaternion>, x = 0, y = 0, z = 0, w = 1) {
    this._x = x;
    this._y = y;
    this._z = z;
    this._w = w;
    this._observer = observer;
  }

  /**
   * Sets the components of this quaternion
   * @example
   * ```ts
   * door.quaternion.set(0, Math.SQRT1_2, 0, Math.SQRT1_2);
   * ```
   * @param x - The x component
   * @param y - The y component
   * @param z - The z component
   * @param w - The w component
   * @returns This quaternion for chaining
   */
  public set(x: number, y: number, z: number, w: number): this {
    if (this._x !== x || this._y !== y || this._z !== z || this._w !== w) {
      this._x = x;
      this._y = y;
      this._z = z;
      this._w = w;
      this._observer._onUpdate(this);
    }

    return this;
  }

  /**
   * Copies `q` into this quaternion
   * @example
   * ```ts
   * door.quaternion.copyFrom(closedRotation);
   * ```
   * @param q - The quaternion to copy from
   * @returns This quaternion for chaining
   */
  public copyFrom(q: QuaternionData): this {
    if (this._x !== q.x || this._y !== q.y || this._z !== q.z || this._w !== q.w) {
      this._x = q.x;
      this._y = q.y;
      this._z = q.z;
      this._w = q.w;
      this._observer._onUpdate(this);
    }

    return this;
  }

  /**
   * Copies this quaternion into `target` and returns it
   * @example
   * ```ts
   * door.quaternion.copyTo(closedRotation);
   * ```
   * @param target - The quaternion to copy into
   * @returns The given `target`
   */
  public copyTo<T extends QuaternionData>(target: T): T {
    target.x = this._x;
    target.y = this._y;
    target.z = this._z;
    target.w = this._w;

    return target;
  }

  /**
   * Creates a copy of this quaternion that notifies `observer`, or this quaternion's own observer when
   * left out
   *
   * A clone of a node's `quaternion` that keeps the node as its observer marks the node for a transform
   * update on every change without turning it. For a plain copy, use
   * `new Quaternion().copyFrom(node.quaternion)`.
   * @param observer - Observer for the clone; defaults to this instance's observer
   * @returns The new quaternion
   */
  // oxlint-disable-next-line pixi3d/require-standard-example -- observer-linked copy; plain copies use Quaternion#copyFrom
  public clone(observer?: Observer<ObservableQuaternion>): ObservableQuaternion {
    return new ObservableQuaternion(observer ?? this._observer, this._x, this._y, this._z, this._w);
  }

  /**
   * Resets this quaternion to identity `(0, 0, 0, 1)`, no rotation
   * @example
   * ```ts
   * crate.quaternion.identity();
   * ```
   * @returns This quaternion for chaining
   */
  public identity(): this {
    return this.set(0, 0, 0, 1);
  }

  /**
   * Returns true when `x`, `y`, `z` and `w` match `q` exactly (no epsilon tolerance)
   * @example
   * ```ts
   * const closed = door.quaternion.equals(closedRotation);
   * ```
   * @param q - The quaternion to compare with
   * @returns Whether all components match
   */
  public equals(q: QuaternionData): boolean {
    return q.x === this._x && q.y === this._y && q.z === this._z && q.w === this._w;
  }

  /**
   * Sets this quaternion from Euler angles in radians, in the XYZ order of
   * {@link Container3D#rotation}
   * @example
   * ```ts
   * door.quaternion.setFromEuler({ x: 0, y: openAngle, z: 0 });
   * ```
   * @param rotation - The Euler angles as `(x, y, z)` radians
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public setFromEuler(rotation: PointData3D, out: QuaternionData = this): this {
    if (out === this) {
      _tempQuat.setFromEuler(rotation);

      return this.set(_tempQuat.x, _tempQuat.y, _tempQuat.z, _tempQuat.w);
    }
    _tempQuat.setFromEuler(rotation, out);

    return out as this;
  }

  /**
   * Sets this quaternion to a turn of `angle` radians around the unit-length `axis`
   * @example
   * ```ts
   * wheel.quaternion.setFromAxisAngle({ x: 1, y: 0, z: 0 }, distanceDriven / wheelRadius);
   * ```
   * @param axis - The unit-length rotation axis
   * @param angle - The rotation angle in radians
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public setFromAxisAngle(axis: PointData3D, angle: number, out: QuaternionData = this): this {
    if (out === this) {
      _tempQuat.setFromAxisAngle(axis, angle);

      return this.set(_tempQuat.x, _tempQuat.y, _tempQuat.z, _tempQuat.w);
    }
    _tempQuat.setFromAxisAngle(axis, angle, out);

    return out as this;
  }

  /**
   * Sets this quaternion to the rotation in `m`
   *
   * The upper-left 3x3 of `m` must be a pure rotation, with no scale. Use
   * {@link ObservableQuaternion#setFromScaledRotationMatrix} for a matrix with scale.
   * @example
   * ```ts
   * securityCamera.quaternion.setFromRotationMatrix(new Matrix4().lookAt(eye, target, up));
   * ```
   * @param m - The rotation matrix to extract from
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public setFromRotationMatrix(m: Matrix4, out: QuaternionData = this): this {
    if (out === this) {
      _tempQuat.setFromRotationMatrix(m);

      return this.set(_tempQuat.x, _tempQuat.y, _tempQuat.z, _tempQuat.w);
    }
    _tempQuat.setFromRotationMatrix(m, out);

    return out as this;
  }

  /**
   * Sets this quaternion to the rotation in `m`, a transform that may also scale each axis
   * @example
   * ```ts
   * debris.quaternion.setFromScaledRotationMatrix(wreck.worldTransform);
   * ```
   * @param m - The transform to extract from
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public setFromScaledRotationMatrix(m: Matrix4, out: QuaternionData = this): this {
    if (out === this) {
      _tempQuat.setFromScaledRotationMatrix(m);

      return this.set(_tempQuat.x, _tempQuat.y, _tempQuat.z, _tempQuat.w);
    }
    _tempQuat.setFromScaledRotationMatrix(m, out);

    return out as this;
  }

  /**
   * Sets this quaternion to the shortest turn that takes unit-length `vFrom` to unit-length `vTo`
   *
   * {@link Quaternion#setFromUnitVectors} covers opposite vectors.
   * @example
   * ```ts
   * tree.quaternion.setFromUnitVectors({ x: 0, y: 1, z: 0 }, groundNormal);
   * ```
   * @param vFrom - The unit-length start direction
   * @param vTo - The unit-length end direction
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public setFromUnitVectors(vFrom: PointData3D, vTo: PointData3D, out: QuaternionData = this): this {
    if (out === this) {
      _tempQuat.setFromUnitVectors(vFrom, vTo);

      return this.set(_tempQuat.x, _tempQuat.y, _tempQuat.z, _tempQuat.w);
    }
    _tempQuat.setFromUnitVectors(vFrom, vTo, out);

    return out as this;
  }

  /**
   * Returns the dot product of this quaternion and `q`
   * @example
   * ```ts
   * const facingTarget = Math.abs(turret.quaternion.dot(aimRotation)) > 0.99999;
   * ```
   * @param q - The other quaternion
   * @returns The dot product
   */
  public dot(q: QuaternionData): number {
    return this._x * q.x + this._y * q.y + this._z * q.z + this._w * q.w;
  }

  /**
   * Returns the angle of the turn from this rotation to `q`
   *
   * Both quaternions are assumed unit-length.
   * @example
   * ```ts
   * if (turret.quaternion.angleTo(aimRotation) < 0.01) fire();
   * ```
   * @param q - The other quaternion
   * @returns The angle in radians, from 0 to π
   */
  public angleTo(q: QuaternionData): number {
    return 2 * Math.acos(Math.abs(clamp(this.dot(q), -1, 1)));
  }

  /**
   * Returns the length of this quaternion as a 4D vector, 1 for a rotation
   * @example
   * ```ts
   * if (Math.abs(ship.quaternion.magnitude() - 1) > 1e-6) ship.quaternion.normalize();
   * ```
   * @returns The magnitude
   */
  public magnitude(): number {
    return Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w);
  }

  /**
   * Returns the squared length of this quaternion
   *
   * Cheaper than {@link ObservableQuaternion#magnitude} and enough to check for drift.
   * @example
   * ```ts
   * if (Math.abs(ship.quaternion.magnitudeSquared() - 1) > 1e-6) ship.quaternion.normalize();
   * ```
   * @returns The squared magnitude
   */
  public magnitudeSquared(): number {
    return this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w;
  }

  /**
   * Scales this quaternion to unit length, undoing the drift of repeated multiplies
   *
   * A zero quaternion becomes identity.
   * @example
   * ```ts
   * ship.quaternion.multiply(roll).normalize();
   * ```
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public normalize(out: QuaternionData = this): this {
    const len = Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w);
    let x: number;
    let y: number;
    let z: number;
    let w: number;
    if (len === 0) {
      x = 0;
      y = 0;
      z = 0;
      w = 1;
    } else {
      const inv = 1 / len;
      x = this._x * inv;
      y = this._y * inv;
      z = this._z * inv;
      w = this._w * inv;
    }

    if (out === this) return this.set(x, y, z, w);
    out.x = x;
    out.y = y;
    out.z = z;
    out.w = w;

    return out as this;
  }

  /**
   * Inverts this rotation, so it turns the other way
   *
   * Computes the {@link ObservableQuaternion#conjugate | conjugate}, which is the inverse of a unit
   * quaternion.
   * @example
   * ```ts
   * turret.quaternion.inverse(parentToTurret);
   * ```
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public inverse(out: QuaternionData = this): this {
    return this.conjugate(out);
  }

  /**
   * Negates `x`, `y` and `z`, leaving `w`, which reverses a unit quaternion's turn
   *
   * The same as {@link ObservableQuaternion#inverse} for a unit quaternion.
   * @example
   * ```ts
   * const reverseTurn = door.quaternion.conjugate(new Quaternion());
   * ```
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public conjugate(out: QuaternionData = this): this {
    if (out === this) return this.set(-this._x, -this._y, -this._z, this._w);
    out.x = -this._x;
    out.y = -this._y;
    out.z = -this._z;
    out.w = this._w;

    return out as this;
  }

  /**
   * Multiplies this quaternion by `q` (`this = this * q`), turning the node by `q` around its own axes
   *
   * {@link Quaternion#multiply} explains the order.
   * @example
   * ```ts
   * roll.setFromAxisAngle(forwardAxis, rollSpeed * dt);
   * ship.quaternion.multiply(roll);
   * ```
   * @param q - The quaternion to multiply by
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public multiply(q: QuaternionData, out: QuaternionData = this): this {
    if (out === this) {
      multiplyQuaternionData(this, q, _tempQuat);

      return this.set(_tempQuat.x, _tempQuat.y, _tempQuat.z, _tempQuat.w);
    }
    multiplyQuaternionData(this, q, out);

    return out as this;
  }

  /**
   * Pre-multiplies this quaternion by `q` (`this = q * this`), turning the node by `q` around its
   * parent's axes
   * @example
   * ```ts
   * spin.setFromAxisAngle(worldUp, spinSpeed * dt);
   * globe.quaternion.premultiply(spin);
   * ```
   * @param q - The quaternion to pre-multiply by
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public premultiply(q: QuaternionData, out: QuaternionData = this): this {
    if (out === this) {
      multiplyQuaternionData(q, this, _tempQuat);

      return this.set(_tempQuat.x, _tempQuat.y, _tempQuat.z, _tempQuat.w);
    }
    multiplyQuaternionData(q, this, out);

    return out as this;
  }

  /**
   * Blends from this rotation toward `qb` by `t`, turning at an even rate the shorter way round
   * @example
   * ```ts
   * turret.quaternion.slerp(aimRotation, 1 - Math.exp(-turnRate * dt));
   * ```
   * @param qb - The quaternion to interpolate towards
   * @param t - The interpolation factor in `[0, 1]`
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public slerp(qb: QuaternionData, t: number, out: QuaternionData = this): this {
    _tempQuat.set(this._x, this._y, this._z, this._w).slerp(qb, t);
    if (out === this) return this.set(_tempQuat.x, _tempQuat.y, _tempQuat.z, _tempQuat.w);
    out.x = _tempQuat.x;
    out.y = _tempQuat.y;
    out.z = _tempQuat.z;
    out.w = _tempQuat.w;

    return out as this;
  }

  /**
   * Reads `x`, `y`, `z`, `w` from `array` starting at `offset`
   * @example
   * ```ts
   * crates.forEach((crate: Container3D, i: number) => crate.quaternion.fromArray(savedRotations, i * 4));
   * ```
   * @param array - The array to read from
   * @param offset - The offset into `array` to read at
   * @returns This quaternion for chaining
   */
  public fromArray(array: number[] | Float32Array, offset = 0): this {
    return this.set(array[offset], array[offset + 1], array[offset + 2], array[offset + 3]);
  }

  /**
   * Writes this quaternion's values into `array` starting at `offset`
   *
   * Allocates a new array when one is not supplied.
   * @example
   * ```ts
   * crates.forEach((crate: Container3D, i: number) => crate.quaternion.toArray(savedRotations, i * 4));
   * ```
   * @param array - The array to write into; a new array when omitted
   * @param offset - The offset into `array` to write at
   * @returns The written array
   */
  public toArray<T extends number[] | Float32Array = number[]>(array: T = [] as unknown as T, offset = 0): T {
    array[offset] = this._x;
    array[offset + 1] = this._y;
    array[offset + 2] = this._z;
    array[offset + 3] = this._w;

    return array;
  }

  /**
   * Returns a string representation of this quaternion
   * @example
   * ```ts
   * console.log(ship.quaternion.toString());
   * ```
   * @returns A string in the form `[pixi-3d/math:ObservableQuaternion x=0 y=0 z=0 w=1]`
   */
  public toString(): string {
    return `[pixi-3d/math:ObservableQuaternion x=${this._x} y=${this._y} z=${this._z} w=${this._w}]`;
  }
}

const _tempQuat = new Quaternion();
