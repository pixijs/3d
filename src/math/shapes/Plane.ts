import type { Matrix4 } from '../matrix/Matrix4';
import type { SHAPE_PRIMITIVE_3D } from '../misc/const';
import type { PointData3D } from '../vector/PointData3D';
import { Vector3 } from '../vector/Vector3';
import type { Box } from './Box';
import type { Ray } from './Ray';
import type { Sphere } from './Sphere';

/**
 * An infinite flat plane: the points `p` where `normal · p + constant = 0`
 *
 * The ground `y = 0` is `new Plane(new Vector3(0, 1, 0), 0)`, and the upward-facing plane `y = 2`
 * has a constant of `-2`. Keep `normal` unit length, or distances come out scaled;
 * {@link Plane#normalize} fixes one that isn't.
 * @example
 * ```ts
 * const water = new Plane(new Vector3(0, 1, 0), -waterLevel);
 *
 * app.ticker.add(() => {
 *   underwaterFilter.enabled = water.distanceToPoint(camera.position) < 0;
 * });
 * ```
 * @see {@link Ray#intersectPlane} For the point where a ray hits the plane
 * @category maths
 * @standard
 */
export class Plane {
  /**
   * The unit-length direction the plane faces; its positive side
   * @example
   * ```ts
   * const facingUp = slope.normal.y > 0.7;
   * ```
   */
  public readonly normal: Vector3;
  /**
   * The origin's signed distance from the plane, negative when the origin is behind it
   * @example
   * ```ts
   * water.constant = -waterLevel;
   * ```
   */
  public constant = 0;

  /**
   * Names the shape without an `instanceof` check, like the `type` on pixi's 2D shapes
   * @readonly
   * @default 'plane'
   */
  // oxlint-disable-next-line pixi3d/require-standard-example -- read-only discriminant
  public readonly type: SHAPE_PRIMITIVE_3D = 'plane';

  /**
   * Creates a new `Plane`
   *
   * Left out, the plane is `x = 0` facing +X. A normal passed in becomes the plane's own; it is
   * not copied.
   * @param normal - The unit-length normal of the plane
   * @param constant - The origin's signed distance from the plane
   */
  constructor(normal?: Vector3, constant = 0) {
    this.normal = normal !== undefined ? normal : new Vector3(1, 0, 0);
    this.constant = constant;
  }

  /**
   * Sets the normal and constant of this plane, copying the normal
   * @example
   * ```ts
   * ceiling.set({ x: 0, y: -1, z: 0 }, roomHeight);
   * ```
   * @param normal - The unit-length normal
   * @param constant - The origin's signed distance from the plane
   * @returns This plane for chaining
   */
  public set(normal: PointData3D, constant: number): this {
    this.normal.copyFrom(normal);
    this.constant = constant;

    return this;
  }

  /**
   * Sets the normal to `(x, y, z)` and the constant to `w`, the four numbers of a plane equation
   *
   * Equations from elsewhere, such as rows of a projection matrix, rarely have a unit-length
   * normal, so call {@link Plane#normalize} after.
   * @example
   * ```ts
   * clipPlane.setComponents(equation[0], equation[1], equation[2], equation[3]).normalize();
   * ```
   * @param x - The x component of the normal
   * @param y - The y component of the normal
   * @param z - The z component of the normal
   * @param w - The plane constant
   * @returns This plane for chaining
   */
  public setComponents(x: number, y: number, z: number, w: number): this {
    this.normal.set(x, y, z);
    this.constant = w;

    return this;
  }

  /**
   * Sets this plane from a unit-length `normal` and a coplanar `point`
   * @example
   * ```ts
   * mirrorPlane.setFromNormalAndCoplanarPoint({ x: 0, y: 0, z: 1 }, mirror.position);
   * ```
   * @param normal - The unit-length normal
   * @param point - A point on the plane
   * @returns This plane for chaining
   */
  public setFromNormalAndCoplanarPoint(normal: PointData3D, point: PointData3D): this {
    this.normal.copyFrom(normal);
    this.constant = -(point.x * this.normal.x + point.y * this.normal.y + point.z * this.normal.z);

    return this;
  }

  /**
   * Copies `plane` into this plane
   * @example
   * ```ts
   * reflectionPlane.copyFrom(water);
   * ```
   * @param plane - The plane to copy from
   * @returns This plane for chaining
   */
  public copyFrom(plane: Plane): this {
    this.normal.copyFrom(plane.normal);
    this.constant = plane.constant;

    return this;
  }

  /**
   * Copies this plane into `target` and returns it
   * @example
   * ```ts
   * water.copyTo(reflectionPlane);
   * ```
   * @param target - The plane to copy into
   * @returns The given `target`
   */
  public copyTo<T extends Plane>(target: T): T {
    target.normal.copyFrom(this.normal);
    target.constant = this.constant;

    return target;
  }

  /**
   * Creates a new `Plane` with the same normal and constant
   * @example
   * ```ts
   * const worldPlane = localPlane.clone().applyMatrix4(portal.worldTransform);
   * ```
   * @returns The new plane
   */
  public clone(): Plane {
    return new Plane().copyFrom(this);
  }

  /**
   * Returns true when `normal` and `constant` match `plane` exactly (no epsilon tolerance)
   * @example
   * ```ts
   * if (!clipPlane.equals(lastClipPlane)) rebuildClipping(clipPlane);
   * ```
   * @param plane - The plane to compare with
   * @returns Whether the normal and constant match
   */
  public equals(plane: Plane): boolean {
    return plane.normal.equals(this.normal) && plane.constant === this.constant;
  }

  /**
   * Scales the plane so `normal` has unit length
   *
   * The constant scales with it, so the plane stays in place. A zero-length normal gives `NaN`.
   * @example
   * ```ts
   * const slope = new Plane(new Vector3(0, 2, 1), 0).normalize();
   * ```
   * @param out - Target to write the result into instead of mutating this plane
   * @returns The result plane for chaining
   */
  public normalize(out: Plane = this): this {
    if (out !== this) out.copyFrom(this);
    const inverseNormalLength = 1.0 / out.normal.magnitude();
    out.normal.multiplyScalar(inverseNormalLength);
    out.constant *= inverseNormalLength;

    return out as this;
  }

  /**
   * Returns the signed distance from `point` to this plane (positive on the side of `normal`)
   * @example
   * ```ts
   * const depth = -water.distanceToPoint(diver.position);
   * ```
   * @param point - The point to measure from
   * @returns The signed distance to the plane
   */
  public distanceToPoint(point: PointData3D): number {
    return this.normal.x * point.x + this.normal.y * point.y + this.normal.z * point.z + this.constant;
  }

  /**
   * Writes the closest point on this plane to `point` into `out` (or a new `Vector3`)
   * @example
   * ```ts
   * const footprint = new Vector3();
   *
   * ground.projectPoint(ball.position, footprint);
   * blobShadow.position.copyFrom(footprint);
   * ```
   * @param point - The point to project
   * @param out - Optional vector to write into; a new `Vector3` when omitted
   * @returns The projected point
   */
  public projectPoint(point: PointData3D, out?: Vector3): Vector3 {
    out ||= new Vector3();

    return out.copyFrom(point).addScaledVector(this.normal, -this.distanceToPoint(point));
  }

  /**
   * Returns true when this plane passes through `box` or touches it; same as {@link Box#intersectsPlane}
   * @example
   * ```ts
   * const halfSubmerged = water.intersectsBox(boatBounds);
   * ```
   * @param box - The box to test
   * @returns Whether the plane passes through or touches the box
   */
  public intersectsBox(box: Box): boolean {
    return box.intersectsPlane(this);
  }

  /**
   * Returns true when this plane passes through `sphere` or touches it; never for an empty sphere
   * @example
   * ```ts
   * const splashing = water.intersectsSphere(ball.boundingSphere);
   * ```
   * @param sphere - The sphere to test
   * @returns Whether the plane passes through or touches the sphere
   */
  public intersectsSphere(sphere: Sphere): boolean {
    return sphere.intersectsPlane(this);
  }

  /**
   * Returns true when `ray` hits this plane; same as {@link Ray#intersectsPlane}
   * @example
   * ```ts
   * cursor.visible = ground.intersectsRay(pointerRay);
   * ```
   * @param ray - The ray to test
   * @returns Whether the ray intersects this plane
   */
  public intersectsRay(ray: Ray): boolean {
    return ray.intersectsPlane(this);
  }

  /**
   * Transforms this plane by an affine `matrix`, so points on it stay on it
   *
   * Non-uniform scale is fine, and the normal comes out unit length. A mirroring matrix swaps
   * which side of the plane is positive. Needs a unit-length `normal`, and `matrix` must be affine
   * (bottom row `[0, 0, 0, 1]`), as a {@link Container3D#worldTransform} always is.
   * @example
   * ```ts
   * const worldMirror = new Plane();
   *
   * localMirror.applyMatrix4(mirror.worldTransform, worldMirror);
   * ```
   * @param matrix - The affine matrix to transform by
   * @param out - Target to write the result into instead of mutating this plane
   * @returns The result plane for chaining
   */
  public applyMatrix4(matrix: Matrix4, out: Plane = this): this {
    if (out !== this) out.copyFrom(this);

    const e = matrix.elements;
    const e0 = e[0];
    const e1 = e[1];
    const e2 = e[2];
    const e4 = e[4];
    const e5 = e[5];
    const e6 = e[6];
    const e8 = e[8];
    const e9 = e[9];
    const e10 = e[10];

    const nx0 = out.normal.x;
    const ny0 = out.normal.y;
    const nz0 = out.normal.z;
    const nx = (e5 * e10 - e6 * e9) * nx0 + (e2 * e9 - e1 * e10) * ny0 + (e1 * e6 - e2 * e5) * nz0;
    const ny = (e6 * e8 - e4 * e10) * nx0 + (e0 * e10 - e2 * e8) * ny0 + (e2 * e4 - e0 * e6) * nz0;
    const nz = (e4 * e9 - e5 * e8) * nx0 + (e1 * e8 - e0 * e9) * ny0 + (e0 * e5 - e1 * e4) * nz0;

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const invLen = 1 / len;
    const newNx = nx * invLen;
    const newNy = ny * invLen;
    const newNz = nz * invLen;

    const px = -out.constant * nx0;
    const py = -out.constant * ny0;
    const pz = -out.constant * nz0;
    const tpx = e0 * px + e4 * py + e8 * pz + e[12];
    const tpy = e1 * px + e5 * py + e9 * pz + e[13];
    const tpz = e2 * px + e6 * py + e10 * pz + e[14];

    out.normal.set(newNx, newNy, newNz);
    out.constant = -(tpx * newNx + tpy * newNy + tpz * newNz);

    return out as this;
  }

  /**
   * Returns a string representation of this plane
   * @returns A string in the form `[pixi-3d/math:Plane normal=(1, 0, 0) constant=0]`
   * @advanced
   */
  public toString(): string {
    return `[pixi-3d/math:Plane normal=(${this.normal.x}, ${this.normal.y}, ${this.normal.z}) constant=${this.constant}]`;
  }
}
