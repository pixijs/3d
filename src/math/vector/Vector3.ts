import type { Matrix3 } from '../matrix/Matrix3';
import type { Matrix4 } from '../matrix/Matrix4';
import type { Quaternion } from '../rotation/Quaternion';
import type { Cylindrical } from '../shapes/Cylindrical';
import type { Spherical } from '../shapes/Spherical';
import { clamp } from '../utils/clamp';
import type { PointData3D } from './PointData3D';
import type { PointLike3D } from './PointLike3D';

/**
 * A point or direction in 3D, such as a position, a velocity or an offset
 *
 * Math methods change the vector they're called on and return it, so calls chain. Pass an `out`
 * vector as the last argument to write the result there instead and leave this one as it is. In code
 * that runs every frame, create `out` vectors once and reuse them: a `new Vector3()` per frame is
 * garbage the collector has to clean up.
 *
 * Where a method takes a point, any {@link PointData3D} works, such as a node's `position` or a
 * plain `{ x, y, z }` object.
 * @example
 * ```ts
 * const toPlayer = new Vector3();
 *
 * app.ticker.add((ticker) => {
 *   player.position.subtract(enemy.position, toPlayer).normalize();
 *   enemy.position.addScaledVector(toPlayer, enemy.speed * (ticker.deltaMS / 1000));
 * });
 * ```
 * @category maths
 * @standard
 */
export class Vector3 implements PointLike3D {
  /**
   * The x component
   * @example
   * ```ts
   * const groundSpeed = Math.hypot(velocity.x, velocity.z);
   * ```
   */
  public x = 0;
  /**
   * The y component
   * @example
   * ```ts
   * velocity.y -= gravity * dt;
   * ```
   */
  public y = 0;
  /**
   * The z component
   * @example
   * ```ts
   * velocity.z = runSpeed;
   * ```
   */
  public z = 0;

  /**
   * A static `Vector3` reset to `(0, 0, 0)` on every access, for a result used straight away
   *
   * > [!IMPORTANT] This vector is shared and temporary. Do not store references to it.
   * @example
   * ```ts
   * const inRange = enemy.getGlobalPosition(Vector3.shared).distanceTo(player.position) < attackRange;
   * ```
   */
  static get shared(): Vector3 {
    _shared.x = 0;
    _shared.y = 0;
    _shared.z = 0;

    return _shared;
  }

  /**
   * Creates a new `Vector3`
   * @param x - The x component
   * @param y - The y component
   * @param z - The z component
   */
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  /**
   * Sets the x, y and z components
   * @example
   * ```ts
   * velocity.set(0, jumpSpeed, 0);
   * size.set(1); // (1, 1, 1)
   * ```
   * @param x - The x component
   * @param y - The y component, defaults to `x`
   * @param z - The z component, defaults to `x`
   */
  public set(x = 0, y = x, z = x): this {
    this.x = x;
    this.y = y;
    this.z = z;

    return this;
  }

  /**
   * Copies x, y, z from the given point into this vector
   * @example
   * ```ts
   * respawnPoint.copyFrom(player.position);
   * ```
   * @param p - The point to copy from
   */
  public copyFrom(p: PointData3D): this {
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;

    return this;
  }

  /**
   * Copies this vector's x, y, z into the given point
   * @example
   * ```ts
   * respawnPoint.copyTo(player.position);
   * ```
   * @param p - The point to copy into
   * @returns The given point with values updated
   */
  public copyTo<T extends PointLike3D>(p: T): T {
    p.set(this.x, this.y, this.z);

    return p;
  }

  /**
   * Checks whether `x`, `y` and `z` all match `p` exactly, with no tolerance
   * @example
   * ```ts
   * if (!aimPoint.equals(lastAimPoint)) recomputeAim();
   * ```
   * @param p - The point to compare against
   */
  public equals(p: PointData3D): boolean {
    return p.x === this.x && p.y === this.y && p.z === this.z;
  }

  /**
   * Creates a copy of this vector
   * @example
   * ```ts
   * const startVelocity = velocity.clone();
   * ```
   */
  public clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  /**
   * Returns a readable string representation of this vector
   * @example
   * ```ts
   * console.log(velocity.toString());
   * ```
   */
  public toString(): string {
    return `[@pixi/3d/math:Vector3 x=${this.x} y=${this.y} z=${this.z}]`;
  }

  /**
   * Reads `x`, `y`, `z` from `array` starting at `offset`
   * @example
   * ```ts
   * vertex.fromArray(positions, vertexIndex * 3);
   * ```
   * @param array - The array to read from
   * @param offset - The index of the first component
   */
  public fromArray(array: number[] | Float32Array, offset = 0): this {
    this.x = array[offset];
    this.y = array[offset + 1];
    this.z = array[offset + 2];

    return this;
  }

  /**
   * Writes this vector's values into `array` starting at `offset`
   *
   * Allocates a new array when one is not supplied.
   * @example
   * ```ts
   * velocity.toArray(velocities, particleIndex * 3);
   * ```
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
   * Adds `v` to this vector
   * @example
   * ```ts
   * waypoint.add({ x: 0, y: 2, z: 0 });
   * barrelBase.add(muzzleOffset, muzzlePosition);
   * ```
   * @param v - The point to add
   * @param out - The target to write the result into, defaults to this vector
   * @returns The point the result was written into
   */
  public add(v: PointData3D, out: PointLike3D = this): this {
    out.x = this.x + v.x;
    out.y = this.y + v.y;
    out.z = this.z + v.z;

    return out as this;
  }

  /**
   * Subtracts `v` from this vector
   * @example
   * ```ts
   * const toTarget = new Vector3();
   *
   * targetPosition.subtract(turretPosition, toTarget);
   * ```
   * @param v - The point to subtract
   * @param out - The target to write the result into, defaults to this vector
   * @returns The point the result was written into
   */
  public subtract(v: PointData3D, out: PointLike3D = this): this {
    out.x = this.x - v.x;
    out.y = this.y - v.y;
    out.z = this.z - v.z;

    return out as this;
  }

  /**
   * Multiplies each component of this vector by the matching component of `v`
   * @example
   * ```ts
   * velocity.multiply({ x: 1, y: 0, z: 1 }, groundVelocity);
   * ```
   * @param v - The point to multiply by
   * @param out - The target to write the result into, defaults to this vector
   * @returns The point the result was written into
   */
  public multiply(v: PointData3D, out: PointLike3D = this): this {
    out.x = this.x * v.x;
    out.y = this.y * v.y;
    out.z = this.z * v.z;

    return out as this;
  }

  /**
   * Multiplies each component of this vector by the scalar `s`
   * @example
   * ```ts
   * velocity.multiplyScalar(friction);
   * direction.multiplyScalar(speed * dt, step);
   * ```
   * @param s - The scalar to multiply by
   * @param out - The target to write the result into, defaults to this vector
   * @returns The point the result was written into
   */
  public multiplyScalar(s: number, out: PointLike3D = this): this {
    out.x = this.x * s;
    out.y = this.y * s;
    out.z = this.z * s;

    return out as this;
  }

  /**
   * Divides each component of this vector by the matching component of `v`
   * @example
   * ```ts
   * worldPosition.divide(cellSize, cell);
   * const column = Math.floor(cell.x);
   * ```
   * @param v - The point to divide by
   * @param out - The target to write the result into, defaults to this vector
   * @returns The point the result was written into
   */
  public divide(v: PointData3D, out: PointLike3D = this): this {
    out.x = this.x / v.x;
    out.y = this.y / v.y;
    out.z = this.z / v.z;

    return out as this;
  }

  /**
   * Divides each component of this vector by the scalar `s`
   * @example
   * ```ts
   * const center = new Vector3();
   *
   * for (const point of points) center.add(point);
   * center.divideScalar(points.length);
   * ```
   * @param s - The scalar to divide by
   * @param out - The target to write the result into, defaults to this vector
   * @returns The point the result was written into
   */
  public divideScalar(s: number, out: PointLike3D = this): this {
    return this.multiplyScalar(1 / s, out);
  }

  /**
   * Adds `v * s` to this vector, such as a velocity times the frame time
   * @example
   * ```ts
   * velocity.addScaledVector(gravity, dt);
   * rayOrigin.addScaledVector(rayDirection, hitDistance, hitPoint);
   * ```
   * @param v - The point to scale and add
   * @param s - The scalar to multiply `v` by
   * @param out - The target to write the result into, defaults to this vector
   * @returns The point the result was written into
   */
  public addScaledVector(v: PointData3D, s: number, out: PointLike3D = this): this {
    out.x = this.x + v.x * s;
    out.y = this.y + v.y * s;
    out.z = this.z + v.z * s;

    return out as this;
  }

  /**
   * Negates each component of this vector, reversing its direction
   * @example
   * ```ts
   * toThreat.negate(fleeDirection);
   * ```
   * @param out - The target to write the result into, defaults to this vector
   * @returns The point the result was written into
   */
  public negate(out: PointLike3D = this): this {
    out.x = -this.x;
    out.y = -this.y;
    out.z = -this.z;

    return out as this;
  }

  /**
   * Sets each component to the smaller of this vector's and `v`'s
   * @example
   * ```ts
   * const boundsMin = new Vector3(Infinity, Infinity, Infinity);
   *
   * for (const point of points) boundsMin.min(point);
   * ```
   * @param v - The point to compare with
   * @param out - The target to write the result into, defaults to this vector
   * @returns The point the result was written into
   */
  public min(v: PointData3D, out: PointLike3D = this): this {
    out.x = Math.min(this.x, v.x);
    out.y = Math.min(this.y, v.y);
    out.z = Math.min(this.z, v.z);

    return out as this;
  }

  /**
   * Sets each component to the larger of this vector's and `v`'s
   * @example
   * ```ts
   * const boundsMax = new Vector3(-Infinity, -Infinity, -Infinity);
   *
   * for (const point of points) boundsMax.max(point);
   * ```
   * @param v - The point to compare with
   * @param out - The target to write the result into, defaults to this vector
   * @returns The point the result was written into
   */
  public max(v: PointData3D, out: PointLike3D = this): this {
    out.x = Math.max(this.x, v.x);
    out.y = Math.max(this.y, v.y);
    out.z = Math.max(this.z, v.z);

    return out as this;
  }

  /**
   * Clamps each component of this vector between the matching components of `min` and `max`
   *
   * Assumes `min <= max` componentwise.
   * @example
   * ```ts
   * cameraTarget.clamp(levelMin, levelMax);
   * ```
   * @param min - The lower bound per component
   * @param max - The upper bound per component
   * @param out - The target to write the result into, defaults to this vector
   * @returns The point the result was written into
   */
  public clamp(min: PointData3D, max: PointData3D, out: PointLike3D = this): this {
    out.x = clamp(this.x, min.x, max.x);
    out.y = clamp(this.y, min.y, max.y);
    out.z = clamp(this.z, min.z, max.z);

    return out as this;
  }

  /**
   * Scales this vector to unit length, keeping its direction
   *
   * A zero vector stays zero.
   * @example
   * ```ts
   * input.normalize();
   * toTarget.normalize(aimDirection);
   * ```
   * @param out - The target to write the result into, defaults to this vector
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
   * Scales this vector so its length equals `length`, keeping its direction
   *
   * A zero vector stays zero.
   * @example
   * ```ts
   * if (velocity.magnitude() > maxSpeed) velocity.setLength(maxSpeed);
   * ```
   * @param length - The target length
   * @param out - The target to write the result into, defaults to this vector
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
   * Computes the length of this vector
   * @example
   * ```ts
   * const speed = velocity.magnitude();
   * ```
   */
  public magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  /**
   * Computes the squared length of this vector
   *
   * Cheaper than {@link Vector3#magnitude}, since it skips the square root, and enough to compare
   * lengths.
   * @example
   * ```ts
   * if (velocity.magnitudeSquared() < 0.0001) velocity.set(0);
   * ```
   */
  public magnitudeSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  /**
   * Computes the distance from this point to `v`
   * @example
   * ```ts
   * const reached = waypoint.distanceTo(player.position) < 0.5;
   * ```
   * @param v - The point to measure to
   */
  public distanceTo(v: PointData3D): number {
    return Math.sqrt(this.distanceToSquared(v));
  }

  /**
   * Computes the squared distance from this point to `v`
   *
   * Cheaper than {@link Vector3#distanceTo} and enough to compare distances.
   * @example
   * ```ts
   * if (bulletPosition.distanceToSquared(target.position) < hitRadius * hitRadius) hit(target);
   * ```
   * @param v - The point to measure to
   */
  public distanceToSquared(v: PointData3D): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;

    return dx * dx + dy * dy + dz * dz;
  }

  /**
   * Computes the dot product of this vector and `v`
   *
   * For unit vectors it's the cosine of the angle between them: 1 when they point the same way, 0 at
   * right angles and -1 when opposite.
   * @example
   * ```ts
   * const targetIsAhead = forward.dot(toTarget) > 0;
   * ```
   * @param v - The other vector
   */
  public dot(v: PointData3D): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  /**
   * Computes the angle between this vector and `v`
   *
   * Returns π/2 when either vector has zero length.
   * @example
   * ```ts
   * const canSeePlayer = forward.angleTo(toPlayer) < visionHalfAngle;
   * ```
   * @param v - The other vector
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
   * edgeA.cross(edgeB, faceNormal).normalize();
   * ```
   * @param v - The other vector
   * @param out - The target to write the result into, defaults to this vector
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
   * Multiplies this vector by the 3x3 matrix `m`, such as a normal matrix
   * @example
   * ```ts
   * const normalMatrix = new Matrix3().getNormalMatrix(mesh.worldTransform);
   *
   * worldNormal.copyFrom(localNormal).applyMatrix3(normalMatrix).normalize();
   * ```
   * @param m - The matrix to apply
   * @param out - The target to write the result into, defaults to this vector
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
   * Transforms this point by `m`, translation included, then divides by the resulting `w`
   *
   * The divide is what a projection matrix needs: with a camera's
   * {@link Camera3D#viewProjection | viewProjection}, x and y come out from -1 to 1 across the
   * visible area, and z from -1 at the near plane to 1 at the far plane. A point behind the camera
   * can land inside that x and y range too, so check z as well. Use
   * {@link Vector3#applyAffineMatrix4} for transforms that don't project, and
   * {@link Vector3#transformDirection} for directions.
   * @example
   * ```ts
   * point.applyMatrix4(camera.viewProjection, ndc);
   * const onScreen = Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && Math.abs(ndc.z) <= 1;
   * ```
   * @param m - The matrix to apply
   * @param out - The target to write the result into, defaults to this vector
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
   * Transforms this point by `m`, translation included, without the divide
   * {@link Vector3#applyMatrix4} does
   *
   * Cheaper, and correct for any transform that doesn't project, such as a node's world transform.
   * @example
   * ```ts
   * muzzleOffset.applyAffineMatrix4(gun.worldTransform, muzzleWorldPosition);
   * ```
   * @param m - The matrix to apply
   * @param out - The target to write the result into, defaults to this vector
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
   * Rotates this vector by the unit {@link Quaternion} `q`
   * @example
   * ```ts
   * forward.set(0, 0, 1).applyQuaternion(ship.quaternion);
   * ```
   * @param q - The unit quaternion to rotate by
   * @param out - The target to write the result into, defaults to this vector
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
   * Turns this direction by the rotation and scale in `m`, ignoring its translation, then normalizes it
   * @example
   * ```ts
   * const cameraForward = new Vector3(0, 0, -1).transformDirection(camera.worldTransform);
   * ```
   * @param m - The matrix whose rotation to apply
   * @param out - The target to write the result into, defaults to this vector
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
   * Sets this point to the position the {@link Spherical} coordinate `s` describes
   *
   * `phi` is the angle down from the +Y axis and `theta` the angle around Y, starting at +Z and turning
   * toward +X.
   * @example
   * ```ts
   * orbit.theta += turnSpeed * dt;
   * cameraOffset.setFromSpherical(orbit);
   * ```
   * @param s - The spherical coordinate to convert
   */
  public setFromSpherical(s: Spherical): this {
    const sinPhiRadius = Math.sin(s.phi) * s.radius;

    this.x = sinPhiRadius * Math.sin(s.theta);
    this.y = Math.cos(s.phi) * s.radius;
    this.z = sinPhiRadius * Math.cos(s.theta);

    return this;
  }

  /**
   * Sets this point to the position the {@link Cylindrical} coordinate `c` describes
   *
   * `theta` is the angle around Y, starting at +Z and turning toward +X, and `y` is the height above the
   * XZ plane.
   * @example
   * ```ts
   * const slot = new Cylindrical(towerRadius, 0, 2);
   *
   * for (let i = 0; i < torchCount; i++) {
   *   slot.theta = (i / torchCount) * Math.PI * 2;
   *   torchPositions[i].setFromCylindrical(slot);
   * }
   * ```
   * @param c - The cylindrical coordinate to convert
   */
  public setFromCylindrical(c: Cylindrical): this {
    this.x = c.radius * Math.sin(c.theta);
    this.y = c.y;
    this.z = c.radius * Math.cos(c.theta);

    return this;
  }

  /**
   * Reads the first three values of column `index` of `m` into this vector
   *
   * In a transform, column 3 is the translation and columns 0 to 2 are the X, Y and Z axes, scaled.
   * @example
   * ```ts
   * const worldPosition = new Vector3().setFromMatrixColumn(node.worldTransform, 3);
   * ```
   * @param m - The matrix to read from
   * @param index - The column index, `0` to `3`
   */
  public setFromMatrixColumn(m: Matrix4, index: number): this {
    return this.fromArray(m.elements, index * 4);
  }
}

const _shared = new Vector3();
