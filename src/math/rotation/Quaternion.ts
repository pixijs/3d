import type { Matrix4 } from '../matrix/Matrix4';
import { clamp } from '../utils/clamp';
import type { PointData3D } from '../vector/PointData3D';

/**
 * Minimal `{ x, y, z, w }` shape of a quaternion, accepted across the math API
 *
 * {@link Quaternion} and {@link ObservableQuaternion} implement it, and so does any plain object with
 * these four numbers. For a turn of `angle` radians around the unit vector `axis`, `(x, y, z)` is
 * `axis * sin(angle / 2)` and `w` is `cos(angle / 2)`.
 * @example
 * ```ts
 * const quarterTurnAroundY: QuaternionData = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
 *
 * door.quaternion.copyFrom(quarterTurnAroundY);
 * ```
 * @category maths
 * @standard
 */
export interface QuaternionData {
  /**
   * The x component
   * @example
   * ```ts
   * const axisX = rotation.x / Math.sqrt(1 - rotation.w * rotation.w);
   * ```
   */
  x: number;
  /**
   * The y component
   * @example
   * ```ts
   * const axisY = rotation.y / Math.sqrt(1 - rotation.w * rotation.w);
   * ```
   */
  y: number;
  /**
   * The z component
   * @example
   * ```ts
   * const axisZ = rotation.z / Math.sqrt(1 - rotation.w * rotation.w);
   * ```
   */
  z: number;
  /**
   * The w component
   * @example
   * ```ts
   * const angle = 2 * Math.acos(rotation.w);
   * ```
   */
  w: number;
}

/**
 * A rotation in 3D, stored as four numbers `(x, y, z, w)`
 *
 * Unlike Euler angles, a quaternion doesn't lose a degree of freedom when two axes line up, and
 * {@link Quaternion#slerp} blends between two of them smoothly. {@link QuaternionData} says what the
 * four numbers mean. A rotation quaternion has length 1. Most methods assume so, and long chains of
 * {@link Quaternion#multiply} drift from it, which {@link Quaternion#normalize} fixes.
 *
 * Methods change the quaternion they're called on and return it, so calls chain. Pass an `out`
 * target last to write the result there instead and leave this one as it is.
 * @example
 * ```ts
 * const up = { x: 0, y: 1, z: 0 };
 * const spin = new Quaternion();
 *
 * app.ticker.add((ticker) => {
 *   spin.setFromAxisAngle(up, spinSpeed * (ticker.deltaMS / 1000));
 *   coin.quaternion.multiply(spin);
 * });
 * ```
 * @see {@link Vector3#applyQuaternion} For applying a quaternion rotation to a point
 * @category maths
 * @standard
 */
export class Quaternion implements QuaternionData {
  /**
   * The x component; {@link QuaternionData} says what it means
   * @example
   * ```ts
   * const axisX = rotation.x / Math.sqrt(1 - rotation.w * rotation.w);
   * ```
   */
  public x = 0;
  /**
   * The y component; {@link QuaternionData} says what it means
   * @example
   * ```ts
   * const axisY = rotation.y / Math.sqrt(1 - rotation.w * rotation.w);
   * ```
   */
  public y = 0;
  /**
   * The z component; {@link QuaternionData} says what it means
   * @example
   * ```ts
   * const axisZ = rotation.z / Math.sqrt(1 - rotation.w * rotation.w);
   * ```
   */
  public z = 0;
  /**
   * The w component; {@link QuaternionData} says what it means
   * @example
   * ```ts
   * const angle = 2 * Math.acos(rotation.w);
   * ```
   */
  public w = 0;

  /**
   * A static `Quaternion` reset to identity on every access, for a result used straight away
   *
   * > [!IMPORTANT] This quaternion is shared and temporary. Do not store references to it.
   * @example
   * ```ts
   * kickOffset.applyQuaternion(Quaternion.shared.setFromEuler(recoil));
   * ```
   */
  static get shared(): Quaternion {
    _shared.x = 0;
    _shared.y = 0;
    _shared.z = 0;
    _shared.w = 1;

    return _shared;
  }

  /**
   * Spherically interpolates between two quaternions stored in flat arrays, writing the result into
   * `dst` without creating a `Quaternion`
   *
   * Like {@link Quaternion#slerp}, it takes the shorter way round. It costs one `Math.sin` where the
   * textbook form costs three, so it suits blending many rotations every frame.
   * @example
   * ```ts
   * Quaternion.slerpFlat(pose, boneIndex * 4, keyframes, frame * 4, keyframes, (frame + 1) * 4, blend);
   * ```
   * @param dst - The array to write the result into
   * @param dstOffset - The offset into `dst` to write at
   * @param src0 - The array holding the start quaternion
   * @param srcOffset0 - The offset into `src0` to read from
   * @param src1 - The array holding the end quaternion
   * @param srcOffset1 - The offset into `src1` to read from
   * @param t - The interpolation factor in `[0, 1]`
   * @advanced
   */
  public static slerpFlat(
    dst: number[],
    dstOffset: number,
    src0: number[],
    srcOffset0: number,
    src1: number[],
    srcOffset1: number,
    t: number,
  ): void {
    let x0 = src0[srcOffset0 + 0];
    let y0 = src0[srcOffset0 + 1];
    let z0 = src0[srcOffset0 + 2];
    let w0 = src0[srcOffset0 + 3];

    let x1 = src1[srcOffset1 + 0];
    let y1 = src1[srcOffset1 + 1];
    let z1 = src1[srcOffset1 + 2];
    let w1 = src1[srcOffset1 + 3];

    if (w0 !== w1 || x0 !== x1 || y0 !== y1 || z0 !== z1) {
      let dot = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1;

      if (dot < 0) {
        x1 = -x1;
        y1 = -y1;
        z1 = -z1;
        w1 = -w1;
        dot = -dot;
      }

      let k0 = 1 - t;
      let k1 = t;

      if (dot < 0.9995) {
        const sinT = Math.sin(t * Math.acos(dot));

        k1 = sinT / Math.sqrt(1 - dot * dot);
        k0 = Math.sqrt(1 - sinT * sinT) - dot * k1;

        x0 = x0 * k0 + x1 * k1;
        y0 = y0 * k0 + y1 * k1;
        z0 = z0 * k0 + z1 * k1;
        w0 = w0 * k0 + w1 * k1;
      } else {
        x0 = x0 * k0 + x1 * k1;
        y0 = y0 * k0 + y1 * k1;
        z0 = z0 * k0 + z1 * k1;
        w0 = w0 * k0 + w1 * k1;

        const f = 1 / Math.sqrt(x0 * x0 + y0 * y0 + z0 * z0 + w0 * w0);
        x0 *= f;
        y0 *= f;
        z0 *= f;
        w0 *= f;
      }
    }

    dst[dstOffset] = x0;
    dst[dstOffset + 1] = y0;
    dst[dstOffset + 2] = z0;
    dst[dstOffset + 3] = w0;
  }

  /**
   * Creates a new `Quaternion`, defaulting to identity `(0, 0, 0, 1)`
   * @param x - The x component
   * @param y - The y component
   * @param z - The z component
   * @param w - The w component
   */
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  /**
   * Sets the components of this quaternion
   * @example
   * ```ts
   * rotation.set(0, Math.SQRT1_2, 0, Math.SQRT1_2);
   * ```
   * @param x - The x component
   * @param y - The y component
   * @param z - The z component
   * @param w - The w component
   * @returns This quaternion for chaining
   */
  public set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;

    return this;
  }

  /**
   * Copies `q` into this quaternion
   * @example
   * ```ts
   * savedRotation.copyFrom(door.quaternion);
   * ```
   * @param q - The quaternion to copy from
   * @returns This quaternion for chaining
   */
  public copyFrom(q: QuaternionData): this {
    this.x = q.x;
    this.y = q.y;
    this.z = q.z;
    this.w = q.w;

    return this;
  }

  /**
   * Copies this quaternion into `target` and returns it
   * @example
   * ```ts
   * savedRotation.copyTo(door.quaternion);
   * ```
   * @param target - The quaternion to copy into
   * @returns The given `target`
   */
  public copyTo<T extends QuaternionData>(target: T): T {
    target.x = this.x;
    target.y = this.y;
    target.z = this.z;
    target.w = this.w;

    return target;
  }

  /**
   * Creates a new `Quaternion` with the same values
   * @example
   * ```ts
   * const restRotation = aimRotation.clone();
   * ```
   * @returns The new quaternion
   */
  public clone(): Quaternion {
    return new Quaternion(this.x, this.y, this.z, this.w);
  }

  /**
   * Resets this quaternion to identity `(0, 0, 0, 1)`, no rotation
   * @example
   * ```ts
   * aimOffset.identity();
   * ```
   * @returns This quaternion for chaining
   */
  public identity(): this {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.w = 1;

    return this;
  }

  /**
   * Returns true when `x`, `y`, `z` and `w` match `q` exactly, with no tolerance
   *
   * `q` and its negation are the same rotation but don't compare equal.
   * @example
   * ```ts
   * if (!aimRotation.equals(lastAimRotation)) updateCrosshair();
   * ```
   * @param q - The quaternion to compare with
   * @returns Whether all components match
   */
  public equals(q: QuaternionData): boolean {
    return q.x === this.x && q.y === this.y && q.z === this.z && q.w === this.w;
  }

  /**
   * Sets this quaternion from Euler angles in radians
   *
   * Uses the XYZ order of {@link Container3D#rotation}, so it gives the rotation a node with those
   * angles has.
   * @example
   * ```ts
   * const facing = new Quaternion().setFromEuler({ x: 0, y: heading, z: 0 });
   * ```
   * @param rotation - The Euler angles as `(x, y, z)` radians
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public setFromEuler(rotation: PointData3D, out: QuaternionData = this): this {
    const halfX = rotation.x * 0.5;
    const halfY = rotation.y * 0.5;
    const halfZ = rotation.z * 0.5;
    const c1 = Math.cos(halfX);
    const c2 = Math.cos(halfY);
    const c3 = Math.cos(halfZ);
    const s1 = Math.sin(halfX);
    const s2 = Math.sin(halfY);
    const s3 = Math.sin(halfZ);

    out.x = s1 * c2 * c3 + c1 * s2 * s3;
    out.y = c1 * s2 * c3 - s1 * c2 * s3;
    out.z = c1 * c2 * s3 + s1 * s2 * c3;
    out.w = c1 * c2 * c3 - s1 * s2 * s3;

    return out as this;
  }

  /**
   * Sets this quaternion to a turn of `angle` radians around the unit-length `axis`
   * @example
   * ```ts
   * const up = { x: 0, y: 1, z: 0 };
   *
   * Quaternion.shared.setFromAxisAngle(up, yaw, rigidBody.quaternion);
   * ```
   * @param axis - The unit-length rotation axis
   * @param angle - The rotation angle in radians
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public setFromAxisAngle(axis: PointData3D, angle: number, out: QuaternionData = this): this {
    const halfAngle = angle / 2;
    const s = Math.sin(halfAngle);

    out.x = axis.x * s;
    out.y = axis.y * s;
    out.z = axis.z * s;
    out.w = Math.cos(halfAngle);

    return out as this;
  }

  /**
   * Sets this quaternion to the rotation in `m`
   *
   * The upper-left 3x3 of `m` must be a pure rotation, with no scale. Use
   * {@link Quaternion#setFromScaledRotationMatrix} for a matrix with scale, such as a node's world
   * transform.
   * @example
   * ```ts
   * const cameraRotation = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye, target, up));
   * ```
   * @param m - The rotation matrix to extract from
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public setFromRotationMatrix(m: Matrix4, out: QuaternionData = this): this {
    const te = m.elements;

    _setFromOrthonormalElements(out, te[0], te[4], te[8], te[1], te[5], te[9], te[2], te[6], te[10]);

    return out as this;
  }

  /**
   * Sets this quaternion to the rotation in `m`, a transform that may also scale each axis
   *
   * A matrix with a zero scale has no rotation to read and gives `NaN`. A mirrored one (negative
   * determinant) gives a quaternion that isn't a rotation; {@link Matrix4#decompose} handles it.
   * @example
   * ```ts
   * const worldRotation = new Quaternion().setFromScaledRotationMatrix(node.worldTransform);
   * ```
   * @param m - The transform to extract from
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public setFromScaledRotationMatrix(m: Matrix4, out: QuaternionData = this): this {
    const te = m.elements;

    let m11 = te[0];
    let m21 = te[1];
    let m31 = te[2];
    let m12 = te[4];
    let m22 = te[5];
    let m32 = te[6];
    let m13 = te[8];
    let m23 = te[9];
    let m33 = te[10];

    const invSx = 1 / Math.sqrt(m11 * m11 + m21 * m21 + m31 * m31);
    const invSy = 1 / Math.sqrt(m12 * m12 + m22 * m22 + m32 * m32);
    const invSz = 1 / Math.sqrt(m13 * m13 + m23 * m23 + m33 * m33);

    m11 *= invSx;
    m21 *= invSx;
    m31 *= invSx;
    m12 *= invSy;
    m22 *= invSy;
    m32 *= invSy;
    m13 *= invSz;
    m23 *= invSz;
    m33 *= invSz;

    _setFromOrthonormalElements(out, m11, m12, m13, m21, m22, m23, m31, m32, m33);

    return out as this;
  }

  /**
   * Sets this quaternion to the shortest turn that takes unit-length `vFrom` to unit-length `vTo`
   *
   * When `vTo` points exactly opposite `vFrom`, the result is a half turn around some axis at right
   * angles to `vFrom`.
   * @example
   * ```ts
   * const tilt = new Quaternion().setFromUnitVectors({ x: 0, y: 1, z: 0 }, groundNormal);
   * ```
   * @param vFrom - The unit-length start direction
   * @param vTo - The unit-length end direction
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public setFromUnitVectors(vFrom: PointData3D, vTo: PointData3D, out: QuaternionData = this): this {
    const EPS = 0.000001;
    let r = vFrom.x * vTo.x + vFrom.y * vTo.y + vFrom.z * vTo.z + 1;

    if (r < EPS) {
      r = 0;
      if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) {
        out.x = -vFrom.y;
        out.y = vFrom.x;
        out.z = 0;
      } else {
        out.x = 0;
        out.y = -vFrom.z;
        out.z = vFrom.y;
      }
    } else {
      out.x = vFrom.y * vTo.z - vFrom.z * vTo.y;
      out.y = vFrom.z * vTo.x - vFrom.x * vTo.z;
      out.z = vFrom.x * vTo.y - vFrom.y * vTo.x;
    }
    out.w = r;

    return _normalize(out) as this;
  }

  /**
   * Returns the dot product of this quaternion and `q`
   *
   * For unit quaternions its absolute value is the cosine of half the angle between the two rotations:
   * 1 for the same rotation.
   * @example
   * ```ts
   * const sameRotation = Math.abs(current.dot(target)) > 0.99999;
   * ```
   * @param q - The other quaternion
   * @returns The dot product
   */
  public dot(q: QuaternionData): number {
    return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
  }

  /**
   * Returns the angle of the turn from this rotation to `q`
   *
   * Both quaternions are assumed unit-length.
   * @example
   * ```ts
   * if (aimRotation.angleTo(targetRotation) < 0.01) fire();
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
   * if (Math.abs(rotation.magnitude() - 1) > 1e-6) rotation.normalize();
   * ```
   * @returns The magnitude
   */
  public magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
  }

  /**
   * Returns the squared length of this quaternion
   *
   * Cheaper than {@link Quaternion#magnitude} and enough to check for drift.
   * @example
   * ```ts
   * if (Math.abs(rotation.magnitudeSquared() - 1) > 1e-6) rotation.normalize();
   * ```
   * @returns The squared magnitude
   */
  public magnitudeSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }

  /**
   * Scales this quaternion to unit length, undoing the drift of repeated multiplies
   *
   * A zero quaternion becomes identity.
   * @example
   * ```ts
   * rotation.multiply(step).normalize();
   * ```
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public normalize(out: QuaternionData = this): this {
    const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
    if (len === 0) {
      out.x = 0;
      out.y = 0;
      out.z = 0;
      out.w = 1;
    } else {
      const inv = 1 / len;
      out.x = this.x * inv;
      out.y = this.y * inv;
      out.z = this.z * inv;
      out.w = this.w * inv;
    }

    return out as this;
  }

  /**
   * Inverts this rotation, so it turns the other way
   *
   * Computes the {@link Quaternion#conjugate | conjugate}, which is the inverse of a unit quaternion.
   * For any other quaternion, call {@link Quaternion#normalize} first.
   * @example
   * ```ts
   * parentWorldRotation.inverse(worldToLocal);
   * direction.applyQuaternion(worldToLocal);
   * ```
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public inverse(out: QuaternionData = this): this {
    return this.conjugate(out);
  }

  /**
   * Negates `x`, `y` and `z`, leaving `w`, which reverses a unit quaternion's turn
   * @example
   * ```ts
   * recoil.conjugate(recovery);
   * ```
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public conjugate(out: QuaternionData = this): this {
    out.x = -this.x;
    out.y = -this.y;
    out.z = -this.z;
    out.w = this.w;

    return out as this;
  }

  /**
   * Multiplies this quaternion by `q` (`this = this * q`)
   *
   * The result turns by `q` first, then by this. On a node's rotation, that turns by `q` around the
   * node's own axes; {@link Quaternion#premultiply} turns around its parent's axes.
   * @example
   * ```ts
   * roll.setFromAxisAngle(forwardAxis, rollSpeed * dt);
   * shipRotation.multiply(roll);
   * ```
   * @param q - The quaternion to multiply by
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public multiply(q: QuaternionData, out: QuaternionData = this): this {
    return multiplyQuaternionData(this, q, out) as this;
  }

  /**
   * Pre-multiplies this quaternion by `q` (`this = q * this`)
   *
   * The result turns by this first, then by `q`. On a node's rotation, that turns by `q` around the
   * parent's axes; {@link Quaternion#multiply} turns around the node's own.
   * @example
   * ```ts
   * spin.setFromAxisAngle(worldUp, spinSpeed * dt);
   * globeRotation.premultiply(spin);
   * ```
   * @param q - The quaternion to pre-multiply by
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public premultiply(q: QuaternionData, out: QuaternionData = this): this {
    return multiplyQuaternionData(q, this, out) as this;
  }

  /**
   * Blends from this rotation toward `qb` by `t`, turning at an even rate the shorter way round
   * @example
   * ```ts
   * aimRotation.slerp(targetRotation, 1 - Math.exp(-turnRate * dt));
   * fromRotation.slerp(toRotation, t, blended);
   * ```
   * @param qb - The quaternion to interpolate towards
   * @param t - The interpolation factor in `[0, 1]`
   * @param out - Target to write the result into instead of this quaternion
   * @returns The result quaternion for chaining
   */
  public slerp(qb: QuaternionData, t: number, out: QuaternionData = this): this {
    if (t === 0) {
      if (out !== this) {
        out.x = this.x;
        out.y = this.y;
        out.z = this.z;
        out.w = this.w;
      }

      return out as this;
    }
    if (t === 1) {
      out.x = qb.x;
      out.y = qb.y;
      out.z = qb.z;
      out.w = qb.w;

      return out as this;
    }

    const x0 = this.x;
    const y0 = this.y;
    const z0 = this.z;
    const w0 = this.w;
    let qbx = qb.x;
    let qby = qb.y;
    let qbz = qb.z;
    let qbw = qb.w;
    let dot = x0 * qbx + y0 * qby + z0 * qbz + w0 * qbw;

    if (dot < 0) {
      qbx = -qbx;
      qby = -qby;
      qbz = -qbz;
      qbw = -qbw;
      dot = -dot;
    }

    let k0 = 1 - t;
    let k1 = t;
    if (dot < 0.9995) {
      const theta = Math.acos(dot);
      const sin = Math.sin(theta);

      k0 = Math.sin(k0 * theta) / sin;
      k1 = Math.sin(t * theta) / sin;

      out.x = x0 * k0 + qbx * k1;
      out.y = y0 * k0 + qby * k1;
      out.z = z0 * k0 + qbz * k1;
      out.w = w0 * k0 + qbw * k1;

      return out as this;
    }

    out.x = x0 * k0 + qbx * k1;
    out.y = y0 * k0 + qby * k1;
    out.z = z0 * k0 + qbz * k1;
    out.w = w0 * k0 + qbw * k1;

    return _normalize(out) as this;
  }

  /**
   * Reads `x`, `y`, `z`, `w` from `array` starting at `offset`
   * @example
   * ```ts
   * keyRotation.fromArray(keyframes, frame * 4);
   * ```
   * @param array - The array to read from
   * @param offset - The offset into `array` to read at
   * @returns This quaternion for chaining
   */
  public fromArray(array: number[] | Float32Array, offset = 0): this {
    this.x = array[offset];
    this.y = array[offset + 1];
    this.z = array[offset + 2];
    this.w = array[offset + 3];

    return this;
  }

  /**
   * Writes this quaternion's values into `array` starting at `offset`
   * @example
   * ```ts
   * rotation.toArray(instanceRotations, instanceIndex * 4);
   * ```
   * @param array - The array to write into; a new array when omitted
   * @param offset - The offset into `array` to write at
   * @returns The written array
   */
  public toArray<T extends number[] | Float32Array = number[]>(array: T = [] as unknown as T, offset = 0): T {
    array[offset] = this.x;
    array[offset + 1] = this.y;
    array[offset + 2] = this.z;
    array[offset + 3] = this.w;

    return array;
  }

  /**
   * Returns a string representation of this quaternion
   * @example
   * ```ts
   * console.log(aimRotation.toString());
   * ```
   * @returns A string in the form `[@pixi/3d/math:Quaternion x=0 y=0 z=0 w=1]`
   */
  public toString(): string {
    return `[@pixi/3d/math:Quaternion x=${this.x} y=${this.y} z=${this.z} w=${this.w}]`;
  }
}

function _setFromOrthonormalElements(
  q: QuaternionData,
  m11: number,
  m12: number,
  m13: number,
  m21: number,
  m22: number,
  m23: number,
  m31: number,
  m32: number,
  m33: number,
): void {
  const trace = m11 + m22 + m33;
  let s;

  if (trace > 0) {
    s = 0.5 / Math.sqrt(trace + 1.0);
    q.w = 0.25 / s;
    q.x = (m32 - m23) * s;
    q.y = (m13 - m31) * s;
    q.z = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
    q.w = (m32 - m23) / s;
    q.x = 0.25 * s;
    q.y = (m12 + m21) / s;
    q.z = (m13 + m31) / s;
  } else if (m22 > m33) {
    s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
    q.w = (m13 - m31) / s;
    q.x = (m12 + m21) / s;
    q.y = 0.25 * s;
    q.z = (m23 + m32) / s;
  } else {
    s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
    q.w = (m21 - m12) / s;
    q.x = (m13 + m31) / s;
    q.y = (m23 + m32) / s;
    q.z = 0.25 * s;
  }
}

/**
 * `target = a * b`; `target` may be `a` or `b`, so every input is read before any write
 * @internal
 */
export function multiplyQuaternionData(a: QuaternionData, b: QuaternionData, target: QuaternionData): QuaternionData {
  const qax = a.x;
  const qay = a.y;
  const qaz = a.z;
  const qaw = a.w;
  const qbx = b.x;
  const qby = b.y;
  const qbz = b.z;
  const qbw = b.w;

  target.x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
  target.y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
  target.z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
  target.w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;

  return target;
}

function _normalize(q: QuaternionData): QuaternionData {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (len === 0) {
    q.x = 0;
    q.y = 0;
    q.z = 0;
    q.w = 1;
  } else {
    const inv = 1 / len;
    q.x *= inv;
    q.y *= inv;
    q.z *= inv;
    q.w *= inv;
  }

  return q;
}

const _shared = new Quaternion();
