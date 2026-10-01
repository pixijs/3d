import type { Matrix4 } from '../matrix/Matrix4';
import type { SHAPE_PRIMITIVE_3D } from '../misc/const';
import type { PointData3D } from '../vector/PointData3D';
import { Vector3 } from '../vector/Vector3';
import { Box } from './Box';
import type { Plane } from './Plane';
import type { Ray } from './Ray';

/**
 * A sphere from `center` and `radius`, mostly used as a bounding volume
 *
 * A sphere is the cheapest volume to test and stays the same shape under rotation, which is why
 * frustum culling uses one. {@link Mesh3D#boundingSphere} gives a mesh's in world space.
 *
 * A negative radius marks the sphere empty, and a new sphere starts empty. Methods that change the
 * sphere do so in place, or write into an `out` sphere when you pass one and leave this sphere as
 * it is.
 * @example
 * ```ts
 * const blast = new Sphere(new Vector3(), 4);
 *
 * blast.center.copyFrom(grenade.position);
 * for (const enemy of enemies) {
 *   if (blast.intersectsSphere(enemy.boundingSphere)) enemy.takeDamage(50);
 * }
 * ```
 * @see {@link Box} For the axis-aligned bounding box counterpart
 * @see {@link Plane} For half-space intersection tests
 * @see {@link Ray} For ray-sphere hit tests
 * @category maths
 * @standard
 */
export class Sphere {
  /**
   * The center of the sphere
   * @example
   * ```ts
   * pickupRange.center.copyFrom(player.position);
   * ```
   */
  public readonly center: Vector3;
  /**
   * The radius of the sphere; negative values mark the sphere as empty
   * @example
   * ```ts
   * shield.radius = 2 + Math.sin(time * 4) * 0.1;
   * ```
   */
  public radius = 0;

  /**
   * Names the shape without an `instanceof` check, like the `type` on pixi's 2D shapes
   * @readonly
   * @default 'sphere'
   */
  // oxlint-disable-next-line pixi3d/require-standard-example -- read-only discriminant
  public readonly type: SHAPE_PRIMITIVE_3D = 'sphere';

  /**
   * Creates a new `Sphere`
   *
   * Left out, the sphere is empty (radius `-1`) at the origin. A center passed in becomes the
   * sphere's own; it is not copied.
   * @param center - The center of the sphere
   * @param radius - The radius of the sphere
   */
  constructor(center?: Vector3, radius = -1) {
    this.center = center !== undefined ? center : new Vector3();
    this.radius = radius;
  }

  /**
   * Sets the center and radius of this sphere, copying the center
   * @example
   * ```ts
   * hearingRange.set(guard.position, 6);
   * ```
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
   * Sets this sphere to the smallest sphere around `box`'s corners
   *
   * The center is the box's center and the radius half its diagonal. An empty box gives an empty
   * sphere.
   * @example
   * ```ts
   * const bounds = new Sphere().setFromBox(model.getLocalBounds());
   * ```
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
   * @example
   * ```ts
   * const cached = new Sphere().copyFrom(mesh.boundingSphere);
   * ```
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
   * @example
   * ```ts
   * mesh.boundingSphere.copyTo(cachedBounds);
   * ```
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
   * @example
   * ```ts
   * const snapshot = mesh.boundingSphere.clone();
   * ```
   * @returns The new sphere
   */
  public clone(): Sphere {
    return new Sphere().copyFrom(this);
  }

  /**
   * Resets this sphere to the empty state (`center = 0`, `radius = -1`)
   * @example
   * ```ts
   * if (!grenade.armed) blast.makeEmpty();
   * ```
   * @returns This sphere for chaining
   */
  public makeEmpty(): this {
    this.center.set(0, 0, 0);
    this.radius = -1;

    return this;
  }

  /**
   * Returns true when this sphere is empty (`radius < 0`)
   * @example
   * ```ts
   * if (!mesh.boundingSphere.isEmpty()) zoomTo(mesh.boundingSphere);
   * ```
   * @returns Whether this sphere is empty
   */
  public isEmpty(): boolean {
    return this.radius < 0;
  }

  /**
   * Returns true when `center` and `radius` match `sphere` exactly (no epsilon tolerance)
   * @example
   * ```ts
   * if (!mesh.boundingSphere.equals(lastBounds)) markShadowDirty();
   * ```
   * @param sphere - The sphere to compare with
   * @returns Whether the center and radius match
   */
  public equals(sphere: Sphere): boolean {
    return sphere.center.equals(this.center) && sphere.radius === this.radius;
  }

  /**
   * Returns the signed distance from `point` to the surface of this sphere (negative when inside)
   * @example
   * ```ts
   * const fade = Math.min(1, Math.max(0, -forceField.distanceToPoint(player.position)));
   * ```
   * @param point - The point to measure from
   * @returns The signed distance to the sphere surface
   */
  public distanceToPoint(point: PointData3D): number {
    return this.center.distanceTo(point) - this.radius;
  }

  /**
   * Returns true when `point` is inside this sphere (boundary is inclusive)
   * @example
   * ```ts
   * if (pickupRange.containsPoint(coin.position)) collect(coin);
   * ```
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
   * @example
   * ```ts
   * if (blast.intersectsBox(crate.bounds)) crate.shatter();
   * ```
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
   * @example
   * ```ts
   * if (ball.boundingSphere.intersectsSphere(paddle.boundingSphere)) bounce();
   * ```
   * @param sphere - The sphere to test
   * @returns Whether the spheres overlap
   */
  public intersectsSphere(sphere: Sphere): boolean {
    if (this.radius < 0 || sphere.radius < 0) return false;
    const radiusSum = this.radius + sphere.radius;

    return this.center.distanceToSquared(sphere.center) <= radiusSum * radiusSum;
  }

  /**
   * Returns true when `plane` passes through this sphere or touches it
   *
   * Empty spheres never intersect.
   * @example
   * ```ts
   * const splashing = ball.boundingSphere.intersectsPlane(water);
   * ```
   * @param plane - The plane to test
   * @returns Whether the plane passes through or touches the sphere
   */
  public intersectsPlane(plane: Plane): boolean {
    if (this.radius < 0) return false;

    return Math.abs(plane.distanceToPoint(this.center)) <= this.radius;
  }

  /**
   * Returns true when `ray` enters this sphere; same as {@link Ray#intersectsSphere}
   * @example
   * ```ts
   * const hovered = mesh.boundingSphere.intersectsRay(pointerRay);
   * ```
   * @param ray - The ray to test
   * @returns Whether the ray enters this sphere
   */
  public intersectsRay(ray: Ray): boolean {
    return ray.intersectsSphere(this);
  }

  /**
   * Transforms this sphere by an affine `matrix`
   *
   * The center moves as a point and the radius grows by the matrix's largest axis scale
   * ({@link Matrix4#getMaxScaleOnAxis}), so the sphere still bounds the shape under rotation and
   * per-axis scale. Under shear, as when a non-uniformly scaled parent holds a rotated child, that
   * scale can come out too small; the square root of {@link Matrix4#getMaxSingularValueSq} always
   * covers the shape. An empty sphere stays empty.
   *
   * `matrix` must be affine (bottom row `[0, 0, 0, 1]`), as a {@link Container3D#worldTransform}
   * always is. Projection matrices are not supported.
   * @example
   * ```ts
   * const worldBounds = new Sphere();
   *
   * mesh.geometry.boundsSphere.applyMatrix4(mesh.worldTransform, worldBounds);
   * ```
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
   * Writes the axis-aligned box around this sphere into `out` (or a new `Box`)
   *
   * An empty sphere gives an empty box.
   * @example
   * ```ts
   * const bounds = mesh.boundingSphere.getBounds(scratchBox);
   * ```
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
   * @advanced
   */
  public toString(): string {
    return `[pixi-3d/math:Sphere center=(${this.center.x}, ${this.center.y}, ${this.center.z}) radius=${this.radius}]`;
  }
}
