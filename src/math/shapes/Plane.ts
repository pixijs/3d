import type { Matrix4 } from '../matrix/Matrix4';
import type { SHAPE_PRIMITIVE_3D } from '../misc/const';
import type { PointData3D } from '../vector/PointData3D';
import { Vector3 } from '../vector/Vector3';
import type { Box } from './Box';
import type { Ray } from './Ray';
import type { Sphere } from './Sphere';

/**
 * The `Plane` object represents a 3D plane in Hessian normal form: `normal . p + constant = 0`
 *
 * The `normal` is assumed to be unit length; methods that depend on this assumption call out the
 * requirement.
 *
 * Math operations follow the unified mutating-default pattern: `a.normalize()` mutates `a`;
 * `a.normalize(out)` writes the result into `out` without mutating `a`.
 * @example
 * ```ts
 * // Plane with normal +Y, passing through origin (the XZ plane)
 * const plane = new Plane(new Vector3(0, 1, 0), 0);
 *
 * plane.distanceToPoint({ x: 0, y: 5, z: 0 }); // 5
 * plane.intersectsSphere(sphere);
 * ```
 * @see {@link Box} For the axis-aligned bounding box counterpart
 * @see {@link Sphere} For the bounding-sphere counterpart
 * @see {@link Ray} For ray-plane hit tests
 * @category maths
 * @standard
 */
export class Plane {
  /** The (unit-length) normal of the plane */
  public readonly normal: Vector3;
  /** The signed distance from the origin to the plane along `normal` */
  public constant: number;

  /**
   * The type of the object, mainly used to avoid `instanceof` checks
   * @readonly
   * @default 'plane'
   */
  public readonly type: SHAPE_PRIMITIVE_3D = 'plane';

  /**
   * Creates a new `Plane`
   *
   * The `normal` is assumed to be normalized.
   * @param normal - The unit-length normal of the plane
   * @param constant - The signed distance from the origin to the plane
   */
  constructor(normal?: Vector3, constant = 0) {
    this.normal = normal !== undefined ? normal : new Vector3(1, 0, 0);
    this.constant = constant;
  }

  /**
   * Sets the normal and constant of this plane
   * @param normal - The unit-length normal
   * @param constant - The signed distance from the origin
   * @returns This plane for chaining
   */
  public set(normal: PointData3D, constant: number): this {
    this.normal.copyFrom(normal);
    this.constant = constant;

    return this;
  }

  /**
   * Sets the plane components from `(x, y, z, w)`
   *
   * Equivalent to `set({ x, y, z }, w)`. Useful for extracting frustum planes from a projection
   * matrix.
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
   * @returns The new plane
   */
  public clone(): Plane {
    return new Plane().copyFrom(this);
  }

  /**
   * Returns true when `normal` and `constant` match `plane` exactly (no epsilon tolerance)
   * @param plane - The plane to compare with
   * @returns Whether the normal and constant match
   */
  public equals(plane: Plane): boolean {
    return plane.normal.equals(this.normal) && plane.constant === this.constant;
  }

  /**
   * Normalizes the plane so `normal` has unit length
   *
   * The constant is scaled by the same factor so the plane equation is preserved. Calling on a
   * zero-length normal produces NaN.
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
   * @param point - The point to measure from
   * @returns The signed distance to the plane
   */
  public distanceToPoint(point: PointData3D): number {
    return this.normal.x * point.x + this.normal.y * point.y + this.normal.z * point.z + this.constant;
  }

  /**
   * Writes the projection of `point` onto this plane into `out` (or a new `Vector3`)
   * @param point - The point to project
   * @param out - Optional vector to write into; a new `Vector3` when omitted
   * @returns The projected point
   */
  public projectPoint(point: PointData3D, out?: Vector3): Vector3 {
    out ||= new Vector3();

    return out.copyFrom(point).addScaledVector(this.normal, -this.distanceToPoint(point));
  }

  /**
   * Returns true when `box` straddles this plane
   * @param box - The box to test
   * @returns Whether the box straddles this plane
   */
  public intersectsBox(box: Box): boolean {
    return box.intersectsPlane(this);
  }

  /**
   * Returns true when `sphere` straddles this plane
   * @param sphere - The sphere to test
   * @returns Whether the sphere straddles this plane
   */
  public intersectsSphere(sphere: Sphere): boolean {
    return sphere.intersectsPlane(this);
  }

  /**
   * Returns true when `ray` intersects this plane
   * @param ray - The ray to test
   * @returns Whether the ray intersects this plane
   */
  public intersectsRay(ray: Ray): boolean {
    return ray.intersectsPlane(this);
  }

  /**
   * Transforms this plane by `matrix`, assumed affine (bottom row `[0, 0, 0, 1]`)
   *
   * The normal is transformed by the cofactor matrix of the upper-left 3x3 (equivalent to
   * det * inverse-transpose) and renormalized; the det-scaling drops out, so no determinant is
   * computed.
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
   */
  public toString(): string {
    return `[pixi-3d/math:Plane normal=(${this.normal.x}, ${this.normal.y}, ${this.normal.z}) constant=${this.constant}]`;
  }
}
