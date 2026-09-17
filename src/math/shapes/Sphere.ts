import type { Matrix4 } from '../matrix/Matrix4';
import type { SHAPE_PRIMITIVE_3D } from '../misc/const';
import type { PointData3D } from '../vector/PointData3D';
import { Vector3 } from '../vector/Vector3';
import { Box } from './Box';
import type { Plane } from './Plane';
import type { Ray } from './Ray';

/**
 * The `Sphere` object represents a bounding sphere defined by `center` and `radius`
 *
 * Math operations follow the unified mutating-default pattern: `a.applyMatrix4(m)` mutates `a`;
 * `a.applyMatrix4(m, out)` writes the result into `out` without mutating `a`.
 * @example
 * ```ts
 * const sphere = new Sphere(new Vector3(0, 0, 0), 5);
 *
 * sphere.containsPoint({ x: 1, y: 2, z: 3 });
 * sphere.intersectsBox(box);
 * sphere.applyMatrix4(worldTransform);
 * ```
 * @see {@link Box} For the axis-aligned bounding box counterpart
 * @see {@link Plane} For half-space intersection tests
 * @see {@link Ray} For ray-sphere hit tests
 * @category maths
 * @standard
 */
export class Sphere {
  /** The center of the sphere */
  public readonly center: Vector3;
  /** The radius of the sphere; negative values mark the sphere as empty */
  public radius: number;

  /**
   * The type of the object, mainly used to avoid `instanceof` checks
   * @readonly
   * @default 'sphere'
   */
  public readonly type: SHAPE_PRIMITIVE_3D = 'sphere';

  /**
   * Creates a new `Sphere`
   * @param center - The center of the sphere
   * @param radius - The radius of the sphere
   */
  constructor(center?: Vector3, radius = -1) {
    this.center = center !== undefined ? center : new Vector3();
    this.radius = radius;
  }

  /**
   * Sets the center and radius of this sphere
   * @param center - The center of the sphere
   * @param radius - The radius of the sphere
   * @returns This sphere for chaining
   */
  public set(center: PointData3D, radius: number): this {
    this.center.copyFrom(center);
    this.radius = radius;

    return this;
  }

  /**
   * Sets this sphere to the bounding sphere of `box`
   *
   * Centre is the box centre; radius is half the space diagonal. Empty boxes yield an empty
   * sphere.
   * @param box - The box to bound
   * @returns This sphere for chaining
   */
  public setFromBox(box: Box): this {
    if (box.isEmpty()) return this.makeEmpty();

    const { min, max } = box;
    this.center.set((min.x + max.x) * 0.5, (min.y + max.y) * 0.5, (min.z + max.z) * 0.5);
    const dx = max.x - min.x;
    const dy = max.y - min.y;
    const dz = max.z - min.z;
    this.radius = 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz);

    return this;
  }

  /**
   * Copies `sphere` into this sphere
   * @param sphere - The sphere to copy from
   * @returns This sphere for chaining
   */
  public copyFrom(sphere: Sphere): this {
    this.center.copyFrom(sphere.center);
    this.radius = sphere.radius;

    return this;
  }

  /**
   * Copies this sphere into `target` and returns it
   * @param target - The sphere to copy into
   * @returns The given `target`
   */
  public copyTo<T extends Sphere>(target: T): T {
    target.center.copyFrom(this.center);
    target.radius = this.radius;

    return target;
  }

  /**
   * Creates a new `Sphere` with the same center and radius
   * @returns The new sphere
   */
  public clone(): Sphere {
    return new Sphere().copyFrom(this);
  }

  /**
   * Resets this sphere to the empty state (`center = 0`, `radius = -1`)
   * @returns This sphere for chaining
   */
  public makeEmpty(): this {
    this.center.set(0, 0, 0);
    this.radius = -1;

    return this;
  }

  /**
   * Returns true when this sphere is empty (`radius < 0`)
   * @returns Whether this sphere is empty
   */
  public isEmpty(): boolean {
    return this.radius < 0;
  }

  /**
   * Returns true when `center` and `radius` match `sphere` exactly (no epsilon tolerance)
   * @param sphere - The sphere to compare with
   * @returns Whether the center and radius match
   */
  public equals(sphere: Sphere): boolean {
    return sphere.center.equals(this.center) && sphere.radius === this.radius;
  }

  /**
   * Returns the signed distance from `point` to the surface of this sphere (negative when inside)
   * @param point - The point to measure from
   * @returns The signed distance to the sphere surface
   */
  public distanceToPoint(point: PointData3D): number {
    return this.center.distanceTo(point) - this.radius;
  }

  /**
   * Returns true when `point` is inside this sphere (boundary is inclusive)
   * @param point - The point to test
   * @returns Whether the point is inside this sphere
   */
  public containsPoint(point: PointData3D): boolean {
    return this.center.distanceToSquared(point) <= this.radius * this.radius;
  }

  /**
   * Returns true when this sphere and `box` overlap
   *
   * Empty spheres never intersect.
   * @param box - The box to test
   * @returns Whether the sphere and box overlap
   */
  public intersectsBox(box: Box): boolean {
    return box.intersectsSphere(this);
  }

  /**
   * Returns true when this sphere and `sphere` overlap
   *
   * Empty spheres never intersect.
   * @param sphere - The sphere to test
   * @returns Whether the spheres overlap
   */
  public intersectsSphere(sphere: Sphere): boolean {
    if (this.radius < 0 || sphere.radius < 0) return false;
    const radiusSum = this.radius + sphere.radius;

    return this.center.distanceToSquared(sphere.center) <= radiusSum * radiusSum;
  }

  /**
   * Returns true when this sphere straddles `plane`
   *
   * Empty spheres never intersect.
   * @param plane - The plane to test
   * @returns Whether the sphere straddles the plane
   */
  public intersectsPlane(plane: Plane): boolean {
    if (this.radius < 0) return false;

    return Math.abs(plane.distanceToPoint(this.center)) <= this.radius;
  }

  /**
   * Returns true when `ray` enters this sphere
   * @param ray - The ray to test
   * @returns Whether the ray enters this sphere
   */
  public intersectsRay(ray: Ray): boolean {
    return ray.intersectsSphere(this);
  }

  /**
   * Transforms this sphere by `matrix` and rebuilds the bounding sphere
   *
   * The radius is conservatively scaled by the maximum axis scale of `matrix` so the result
   * remains a sphere even under non-uniform transforms. Empty spheres are left empty.
   *
   * Assumes `matrix` is affine (bottom row `[0, 0, 0, 1]`); this is the universal case for
   * `Container3D.worldTransform`. Projection matrices are not supported here.
   * @param matrix - The affine matrix to transform by
   * @param out - Target to write the result into instead of mutating this sphere
   * @returns The result sphere for chaining
   */
  public applyMatrix4(matrix: Matrix4, out: Sphere = this): this {
    if (out !== this) out.copyFrom(this);
    if (out.isEmpty()) return out as this;
    out.center.applyAffineMatrix4(matrix);
    out.radius = out.radius * matrix.getMaxScaleOnAxis();

    return out as this;
  }

  /**
   * Writes the AABB of this sphere into `out` (or a new `Box`)
   * @param out - Optional box to write into; a new `Box` when omitted
   * @returns The bounds of this sphere
   */
  public getBounds(out?: Box): Box {
    out ||= new Box();
    if (this.isEmpty()) return out.makeEmpty();
    out.min.set(this.center.x - this.radius, this.center.y - this.radius, this.center.z - this.radius);
    out.max.set(this.center.x + this.radius, this.center.y + this.radius, this.center.z + this.radius);

    return out;
  }

  /**
   * Returns a string representation of this sphere
   * @returns A string in the form `[pixi-3d/math:Sphere center=(0, 0, 0) radius=1]`
   */
  public toString(): string {
    return `[pixi-3d/math:Sphere center=(${this.center.x}, ${this.center.y}, ${this.center.z}) radius=${this.radius}]`;
  }
}
