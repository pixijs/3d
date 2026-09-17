import type { Observer } from 'pixi.js';

import type { Matrix4 } from '../matrix/Matrix4';
import { clamp } from '../utils/clamp';
import type { PointData3D } from '../vector/PointData3D';
import { multiplyQuaternionData, Quaternion } from './Quaternion';
import type { QuaternionData } from './Quaternion';

/**
 * The `ObservableQuaternion` object represents a rotation in 3D space using `(x, y, z, w)`
 *
 * It mirrors the API of {@link Quaternion} but invokes an observer callback whenever its
 * components change, making it suitable for transform rotation where change detection drives
 * downstream updates.
 *
 * Math operations follow the unified mutating-default pattern: `a.multiply(b)` mutates `a` in
 * place; `a.multiply(b, out)` writes the result into `out` instead. In-place mutations route
 * through {@link ObservableQuaternion#set} so the observer fires exactly once per call. When `out`
 * is a different target, this quaternion's observer is not fired.
 * @see {@link Quaternion} For the non-observable counterpart
 * @see {@link Observer} For the observer interface
 * @category maths
 * @standard
 */
export class ObservableQuaternion implements QuaternionData {
  /** @ignore */
  public _x: number;
  /** @ignore */
  public _y: number;
  /** @ignore */
  public _z: number;
  /** @ignore */
  public _w: number;

  /** Object whose `_onUpdate` callback is invoked when this quaternion changes */
  private readonly _observer: Observer<ObservableQuaternion>;

  /** The x component; assigning a different value fires the observer */
  get x(): number {
    return this._x;
  }

  /**
   * Sets the x component; fires the observer only when the value changes
   * @param value - New x component
   */
  set x(value: number) {
    if (this._x !== value) {
      this._x = value;
      this._observer._onUpdate(this);
    }
  }

  /** The y component; assigning a different value fires the observer */
  get y(): number {
    return this._y;
  }

  /**
   * Sets the y component; fires the observer only when the value changes
   * @param value - New y component
   */
  set y(value: number) {
    if (this._y !== value) {
      this._y = value;
      this._observer._onUpdate(this);
    }
  }

  /** The z component; assigning a different value fires the observer */
  get z(): number {
    return this._z;
  }

  /**
   * Sets the z component; fires the observer only when the value changes
   * @param value - New z component
   */
  set z(value: number) {
    if (this._z !== value) {
      this._z = value;
      this._observer._onUpdate(this);
    }
  }

  /** The w component; assigning a different value fires the observer */
  get w(): number {
    return this._w;
  }

  /**
   * Sets the w component; fires the observer only when the value changes
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
   *
   * The observer fires once if any component changes.
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
   *
   * The observer fires once if any component changes.
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
   * Creates a new `ObservableQuaternion` with the same values
   *
   * The clone reuses this instance's observer unless `observer` is provided explicitly.
   * @param observer - Observer for the clone; defaults to this instance's observer
   * @returns The new quaternion
   */
  public clone(observer?: Observer<ObservableQuaternion>): ObservableQuaternion {
    return new ObservableQuaternion(observer ?? this._observer, this._x, this._y, this._z, this._w);
  }

  /**
   * Resets this quaternion to identity `(0, 0, 0, 1)`
   *
   * The observer fires once if any component changes.
   * @returns This quaternion for chaining
   */
  public identity(): this {
    return this.set(0, 0, 0, 1);
  }

  /**
   * Returns true when `x`, `y`, `z` and `w` match `q` exactly (no epsilon tolerance)
   * @param q - The quaternion to compare with
   * @returns Whether all components match
   */
  public equals(q: QuaternionData): boolean {
    return q.x === this._x && q.y === this._y && q.z === this._z && q.w === this._w;
  }

  /**
   * Sets this quaternion from Euler angles in XYZ order (radians)
   * @param rotation - The Euler angles as `(x, y, z)` radians
   * @param out - Target to write the result into instead of mutating this quaternion
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
   * Sets this quaternion from a unit-length `axis` and `angle` in radians
   * @param axis - The unit-length rotation axis
   * @param angle - The rotation angle in radians
   * @param out - Target to write the result into instead of mutating this quaternion
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
   * Sets this quaternion from rotation matrix `m`
   *
   * Assumes the upper-left 3x3 of `m` is a pure rotation (unscaled). Use
   * {@link ObservableQuaternion#setFromScaledRotationMatrix} for matrices with scale.
   * @param m - The rotation matrix to extract from
   * @param out - Target to write the result into instead of mutating this quaternion
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
   * Sets this quaternion from a TRS-composed matrix that may carry per-axis scale
   *
   * Strips column scales inline before extraction.
   * @param m - The TRS matrix to extract from
   * @param out - Target to write the result into instead of mutating this quaternion
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
   * Sets this quaternion to the rotation that takes unit-length `vFrom` to unit-length `vTo`
   *
   * Antiparallel inputs (where `vFrom = -vTo`) pick an arbitrary perpendicular axis.
   * @param vFrom - The unit-length start direction
   * @param vTo - The unit-length end direction
   * @param out - Target to write the result into instead of mutating this quaternion
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
   * @param q - The other quaternion
   * @returns The dot product
   */
  public dot(q: QuaternionData): number {
    return this._x * q.x + this._y * q.y + this._z * q.z + this._w * q.w;
  }

  /**
   * Returns the angle in radians between this quaternion and `q`
   *
   * Both quaternions are assumed unit-length.
   * @param q - The other quaternion
   * @returns The angle in radians
   */
  public angleTo(q: QuaternionData): number {
    return 2 * Math.acos(Math.abs(clamp(this.dot(q), -1, 1)));
  }

  /**
   * Returns the magnitude (length) of this quaternion as a 4D vector
   * @returns The magnitude
   */
  public magnitude(): number {
    return Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w);
  }

  /**
   * Returns the squared magnitude of this quaternion
   *
   * Cheaper than {@link ObservableQuaternion#magnitude} for comparisons.
   * @returns The squared magnitude
   */
  public magnitudeSquared(): number {
    return this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w;
  }

  /**
   * Normalizes this quaternion to unit length
   *
   * Zero-magnitude quaternions become identity.
   * @param out - Target to write the result into instead of mutating this quaternion
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
   * Inverts this quaternion
   *
   * Equivalent to {@link ObservableQuaternion#conjugate} for unit-length quaternions, which this
   * method assumes.
   * @param out - Target to write the result into instead of mutating this quaternion
   * @returns The result quaternion for chaining
   */
  public inverse(out: QuaternionData = this): this {
    return this.conjugate(out);
  }

  /**
   * Sets this quaternion to its conjugate (negates the imaginary part)
   * @param out - Target to write the result into instead of mutating this quaternion
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
   * Multiplies this quaternion by `q` (`this = this * q`)
   * @param q - The quaternion to multiply by
   * @param out - Target to write the result into instead of mutating this quaternion
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
   * Pre-multiplies this quaternion by `q` (`this = q * this`)
   * @param q - The quaternion to pre-multiply by
   * @param out - Target to write the result into instead of mutating this quaternion
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
   * Spherically interpolates between this quaternion and `qb` by `t` in `[0, 1]`
   *
   * Always picks the shorter arc.
   * @param qb - The quaternion to interpolate towards
   * @param t - The interpolation factor in `[0, 1]`
   * @param out - Target to write the result into instead of mutating this quaternion
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
   *
   * The observer fires once if any component changes.
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
   * @returns A string in the form `[pixi-3d/math:ObservableQuaternion x=0 y=0 z=0 w=1]`
   */
  public toString(): string {
    return `[pixi-3d/math:ObservableQuaternion x=${this._x} y=${this._y} z=${this._z} w=${this._w}]`;
  }
}

const _tempQuat = new Quaternion();
