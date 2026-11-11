import type { Matrix4 } from '../matrix/Matrix4';
import type { SHAPE_PRIMITIVE_3D } from '../misc/const';
import type { PointData3D } from '../vector/PointData3D';
import { Vector3 } from '../vector/Vector3';
import type { Box } from './Box';
import type { Plane } from './Plane';
import type { Sphere } from './Sphere';

/**
 * A half-line that starts at `origin` and runs along `direction`, for picking and line-of-sight
 * tests
 *
 * {@link View3D#screenToRay} builds one through a pointer position, in world space. Test a ray
 * against shapes in its own space; {@link Ray#applyMatrix4} moves it into a mesh's local space.
 * Keep `direction` unit length, and call `direction.normalize()` after changing it by hand; the
 * distance, closest-point and sphere methods give wrong results otherwise.
 * @example
 * ```ts
 * const hit = new Vector3();
 *
 * view3d.on('pointertap', (e) => {
 *   const ray = view3d.screenToRay(e.global);
 *
 *   if (ray.intersectPlane(ground, hit)) unit.moveTo(hit);
 * });
 * ```
 * @category maths
 * @standard
 */
export class Ray {
  /**
   * The point the ray starts from
   * @example
   * ```ts
   * muzzle.getGlobalPosition(shotRay.origin);
   * ```
   */
  public readonly origin: Vector3;
  /**
   * The unit-length direction the ray runs in
   * @example
   * ```ts
   * sightLine.direction.copyFrom(target.position).subtract(sightLine.origin).normalize();
   * ```
   */
  public readonly direction: Vector3;

  /**
   * Names the shape without an `instanceof` check, like the `type` on pixi's 2D shapes
   * @readonly
   * @default 'ray'
   */
  // oxlint-disable-next-line pixi3d/require-standard-example -- read-only discriminant
  public readonly type: SHAPE_PRIMITIVE_3D = 'ray';

  /**
   * Creates a new `Ray`
   *
   * Left out, the ray starts at the origin and points down -Z. Vectors passed in become the ray's
   * own; they are not copied.
   * @param origin - The origin of the ray
   * @param direction - The unit-length direction of the ray
   */
  constructor(origin?: Vector3, direction?: Vector3) {
    this.origin = origin !== undefined ? origin : new Vector3();
    this.direction = direction !== undefined ? direction : new Vector3(0, 0, -1);
  }

  /**
   * Sets the origin and direction of this ray, copying their values
   * @example
   * ```ts
   * camera.worldTransform.extractForward(forward);
   * aimRay.set(camera.getGlobalPosition(eye), forward);
   * ```
   * @param origin - The origin of the ray
   * @param direction - The unit-length direction of the ray
   * @returns This ray for chaining
   */
  public set(origin: PointData3D, direction: PointData3D): this {
    this.origin.copyFrom(origin);
    this.direction.copyFrom(direction);

    return this;
  }

  /**
   * Copies `ray` into this ray
   * @example
   * ```ts
   * lastPointerRay.copyFrom(pointerRay);
   * ```
   * @param ray - The ray to copy from
   * @returns This ray for chaining
   */
  public copyFrom(ray: Ray): this {
    this.origin.copyFrom(ray.origin);
    this.direction.copyFrom(ray.direction);

    return this;
  }

  /**
   * Copies this ray into `target` and returns it
   * @example
   * ```ts
   * pointerRay.copyTo(lastPointerRay);
   * ```
   * @param target - The ray to copy into
   * @returns The given `target`
   */
  public copyTo<T extends Ray>(target: T): T {
    target.origin.copyFrom(this.origin);
    target.direction.copyFrom(this.direction);

    return target;
  }

  /**
   * Creates a new `Ray` with the same origin and direction
   * @example
   * ```ts
   * const reflected = incoming.clone();
   * ```
   * @returns The new ray
   */
  public clone(): Ray {
    return new Ray().copyFrom(this);
  }

  /**
   * Returns true when `origin` and `direction` match `ray` exactly (no epsilon tolerance)
   * @example
   * ```ts
   * if (!pointerRay.equals(lastPointerRay)) updateHover(pointerRay);
   * ```
   * @param ray - The ray to compare with
   * @returns Whether the origin and direction match
   */
  public equals(ray: Ray): boolean {
    return ray.origin.equals(this.origin) && ray.direction.equals(this.direction);
  }

  /**
   * Writes the point `origin + direction * t` into `out`
   *
   * With a unit-length `direction`, `t` is the distance from `origin`.
   * @example
   * ```ts
   * const reticle = new Vector3();
   *
   * aimRay.at(20, reticle);
   * ```
   * @param t - The distance along the ray
   * @param out - Optional vector to write into; a new `Vector3` when omitted
   * @returns The point along the ray
   */
  public at(t: number, out?: Vector3): Vector3 {
    out ||= new Vector3();
    out.x = this.origin.x + this.direction.x * t;
    out.y = this.origin.y + this.direction.y * t;
    out.z = this.origin.z + this.direction.z * t;

    return out;
  }

  /**
   * Writes the closest point on this ray to `point` into `out`
   *
   * Points behind `origin` give `origin`. Requires a unit-length `direction`.
   * @example
   * ```ts
   * const nearest = new Vector3();
   *
   * aimRay.closestPointToPoint(enemy.position, nearest);
   * ```
   * @param point - The point to measure from
   * @param out - Optional vector to write into; a new `Vector3` when omitted
   * @returns The closest point on this ray
   */
  public closestPointToPoint(point: PointData3D, out?: Vector3): Vector3 {
    out ||= new Vector3();
    const dx = point.x - this.origin.x;
    const dy = point.y - this.origin.y;
    const dz = point.z - this.origin.z;
    const directionDistance = dx * this.direction.x + dy * this.direction.y + dz * this.direction.z;

    if (directionDistance < 0) return out.copyFrom(this.origin);

    return out.copyFrom(this.origin).addScaledVector(this.direction, directionDistance);
  }

  /**
   * Returns the Euclidean distance from `point` to the closest point on this ray
   *
   * Requires a unit-length `direction`.
   * @example
   * ```ts
   * const nearMiss = aimRay.distanceToPoint(target.position) < 0.5;
   * ```
   * @param point - The point to measure from
   * @returns The distance to the closest point on this ray
   */
  public distanceToPoint(point: PointData3D): number {
    return Math.sqrt(this.distanceSqToPoint(point));
  }

  /**
   * Returns the squared Euclidean distance from `point` to the closest point on this ray
   *
   * Cheaper than {@link Ray#distanceToPoint}; compare it against a squared radius. Requires a
   * unit-length `direction`.
   * @example
   * ```ts
   * const locked = enemies.find((enemy: Container3D) => aimRay.distanceSqToPoint(enemy.position) < 0.25);
   * ```
   * @param point - The point to measure from
   * @returns The squared distance to the closest point on this ray
   */
  public distanceSqToPoint(point: PointData3D): number {
    const dx = point.x - this.origin.x;
    const dy = point.y - this.origin.y;
    const dz = point.z - this.origin.z;
    const directionDistance = dx * this.direction.x + dy * this.direction.y + dz * this.direction.z;

    if (directionDistance < 0) return this.origin.distanceToSquared(point);

    const cx = this.origin.x + this.direction.x * directionDistance;
    const cy = this.origin.y + this.direction.y * directionDistance;
    const cz = this.origin.z + this.direction.z * directionDistance;
    const ex = cx - point.x;
    const ey = cy - point.y;
    const ez = cz - point.z;

    return ex * ex + ey * ey + ez * ez;
  }

  /**
   * Intersects this ray with `sphere`
   *
   * An empty sphere is never hit. Requires a unit-length `direction`.
   * @example
   * ```ts
   * const hit = new Vector3();
   *
   * if (ray.intersectSphere(planet.boundingSphere, hit)) flag.position.copyFrom(hit);
   * ```
   * @param sphere - The sphere to intersect
   * @param out - Optional vector to write into; a new `Vector3` when omitted
   * @returns The entry point (or the exit point from inside), or `null` when the ray misses
   * @see {@link Ray#intersectSphereT} For the distance to the same hit, without the point.
   */
  public intersectSphere(sphere: Sphere, out?: Vector3): Vector3 | null {
    const t = this.intersectSphereT(sphere);

    return t === -1 ? null : this.at(t, out);
  }

  /**
   * Intersects this ray with `sphere` and returns the distance to the hit rather than the point
   *
   * Same hit as {@link Ray#intersectSphere}; {@link Ray#at} turns the distance into the point.
   * Compare distances to find the nearest of several hits without making a point for each.
   * Requires a unit-length `direction`.
   * @example
   * ```ts
   * let nearest: Mesh3D | null = null;
   * let nearestT = Infinity;
   *
   * for (const target of targets) {
   *   const t = ray.intersectSphereT(target.boundingSphere);
   *
   *   if (t !== -1 && t < nearestT) {
   *     nearestT = t;
   *     nearest = target;
   *   }
   * }
   * ```
   * @param sphere - The sphere to intersect
   * @returns The distance `t` to the hit (`>= 0`), or `-1` when the ray misses
   */
  public intersectSphereT(sphere: Sphere): number {
    if (sphere.radius < 0) return -1;

    const cx = sphere.center.x - this.origin.x;
    const cy = sphere.center.y - this.origin.y;
    const cz = sphere.center.z - this.origin.z;
    const tca = cx * this.direction.x + cy * this.direction.y + cz * this.direction.z;
    const d2 = cx * cx + cy * cy + cz * cz - tca * tca;
    const radius2 = sphere.radius * sphere.radius;

    if (d2 > radius2) return -1;

    const thc = Math.sqrt(radius2 - d2);
    const t0 = tca - thc;
    const t1 = tca + thc;

    if (t1 < 0) return -1;

    return t0 < 0 ? t1 : t0;
  }

  /**
   * Returns true when this ray hits `sphere`
   *
   * Requires a unit-length `direction`. An empty sphere is never hit.
   * @example
   * ```ts
   * const hovered = enemies.filter((enemy: Mesh3D) => pointerRay.intersectsSphere(enemy.boundingSphere));
   * ```
   * @param sphere - The sphere to test
   * @returns Whether the ray hits the sphere
   */
  public intersectsSphere(sphere: Sphere): boolean {
    if (sphere.radius < 0) return false;

    return this.distanceSqToPoint(sphere.center) <= sphere.radius * sphere.radius;
  }

  /**
   * Intersects this ray with `plane`
   *
   * A ray that lies in the plane hits at its origin. Works with a `direction` of any length.
   * @example
   * ```ts
   * const ground = new Plane(new Vector3(0, 1, 0), 0);
   * const target = new Vector3();
   *
   * if (pointerRay.intersectPlane(ground, target)) cursor.position.copyFrom(target);
   * ```
   * @param plane - The plane to intersect
   * @param out - Optional vector to write into; a new `Vector3` when omitted
   * @returns The hit point, or `null` when the ray points away from the plane or runs parallel to it
   */
  public intersectPlane(plane: Plane, out?: Vector3): Vector3 | null {
    const denominator = plane.normal.dot(this.direction);

    if (denominator === 0) {
      if (plane.distanceToPoint(this.origin) === 0) {
        out ||= new Vector3();

        return out.copyFrom(this.origin);
      }

      return null;
    }

    const t = -plane.distanceToPoint(this.origin) / denominator;

    if (t < 0) return null;

    return this.at(t, out);
  }

  /**
   * Returns true when this ray hits `plane`, including when its origin lies on the plane
   * @example
   * ```ts
   * const canLand = dropRay.intersectsPlane(ground);
   * ```
   * @param plane - The plane to test
   * @returns Whether the ray hits the plane
   */
  public intersectsPlane(plane: Plane): boolean {
    const distToPoint = plane.distanceToPoint(this.origin);
    if (distToPoint === 0) return true;
    const denominator = plane.normal.dot(this.direction);

    return denominator * distToPoint < 0;
  }

  /**
   * Intersects this ray with `box`
   *
   * Works with a `direction` of any length.
   * @example
   * ```ts
   * const hit = new Vector3();
   *
   * if (localRay.intersectBox(mesh.geometry.bounds3D, hit)) decal.position.copyFrom(hit);
   * ```
   * @param box - The box to intersect
   * @param out - Optional vector to write into; a new `Vector3` when omitted
   * @returns The entry point (or the exit point from inside), or `null` when the ray misses
   * @see {@link Ray#intersectBoxT} For the distance to the same hit, without the point.
   */
  public intersectBox(box: Box, out?: Vector3): Vector3 | null {
    const t = this.intersectBoxT(box);

    return t === -1 ? null : this.at(t, out);
  }

  /**
   * Returns true when this ray hits `box`
   * @example
   * ```ts
   * const hovered = pointerRay.intersectsBox(buttonBounds);
   * ```
   * @param box - The box to test
   * @returns Whether the ray hits the box
   */
  public intersectsBox(box: Box): boolean {
    return this.intersectBoxT(box) !== -1;
  }

  /**
   * Transforms this ray by an affine `matrix`
   *
   * The direction comes out unit length, so a `t` measured along the new ray is in the new space's
   * units: under scale, compare hits as points, not as `t` values.
   *
   * `matrix` must be affine (bottom row `[0, 0, 0, 1]`), as a {@link Container3D#worldTransform}
   * always is and a projection matrix isn't.
   * @example
   * ```ts
   * const worldToLocal = new Matrix4().getInverse(mesh.worldTransform);
   * const localRay = pointerRay.applyMatrix4(worldToLocal, new Ray());
   * const overMesh = localRay.intersectsBox(mesh.geometry.bounds3D);
   * ```
   * @param matrix - The affine matrix to transform by
   * @param out - Target to write the result into instead of mutating this ray
   * @returns The result ray for chaining
   */
  public applyMatrix4(matrix: Matrix4, out: Ray = this): this {
    if (out !== this) out.copyFrom(this);
    out.origin.applyAffineMatrix4(matrix);
    out.direction.transformDirection(matrix);

    return out as this;
  }

  /**
   * Intersects this ray with `box` and returns the distance to the hit rather than the point
   *
   * Same hit as {@link Ray#intersectBox}; {@link Ray#at} turns `t` into the point. With a
   * unit-length `direction`, `t` is the distance from `origin`. A ray that runs along one of the
   * box's faces still gets the right entry or exit distance.
   * @example
   * ```ts
   * const t = sightLine.intersectBoxT(wallBounds);
   * const blocked = t !== -1 && t < distanceToTarget;
   * ```
   * @param box - The box to intersect
   * @returns The distance `t` to the entry point, or to the exit point when the origin is inside
   * the box, or `-1` when the ray misses
   */
  public intersectBoxT(box: Box): number {
    const invdirx = 1 / this.direction.x;
    const invdiry = 1 / this.direction.y;
    const invdirz = 1 / this.direction.z;
    const origin = this.origin;

    let tmin: number;
    let tmax: number;
    let tymin: number;
    let tymax: number;
    let tzmin: number;
    let tzmax: number;

    if (invdirx >= 0) {
      tmin = (box.min.x - origin.x) * invdirx;
      tmax = (box.max.x - origin.x) * invdirx;
    } else {
      tmin = (box.max.x - origin.x) * invdirx;
      tmax = (box.min.x - origin.x) * invdirx;
    }

    if (invdiry >= 0) {
      tymin = (box.min.y - origin.y) * invdiry;
      tymax = (box.max.y - origin.y) * invdiry;
    } else {
      tymin = (box.max.y - origin.y) * invdiry;
      tymax = (box.min.y - origin.y) * invdiry;
    }

    if (tmin > tymax || tymin > tmax) return -1;

    if (tymin > tmin || Number.isNaN(tmin)) tmin = tymin;
    if (tymax < tmax || Number.isNaN(tmax)) tmax = tymax;

    if (invdirz >= 0) {
      tzmin = (box.min.z - origin.z) * invdirz;
      tzmax = (box.max.z - origin.z) * invdirz;
    } else {
      tzmin = (box.max.z - origin.z) * invdirz;
      tzmax = (box.min.z - origin.z) * invdirz;
    }

    if (tmin > tzmax || tzmin > tmax) return -1;

    if (tzmin > tmin || Number.isNaN(tmin)) tmin = tzmin;
    if (tzmax < tmax || Number.isNaN(tmax)) tmax = tzmax;

    if (tmax < 0) return -1;

    return tmin >= 0 ? tmin : tmax;
  }

  /**
   * Returns a string representation of this ray
   * @returns A string in the form `[pixi-3d/math:Ray origin=(0, 0, 0) direction=(0, 0, -1)]`
   * @advanced
   */
  public toString(): string {
    return `[pixi-3d/math:Ray origin=(${this.origin.x}, ${this.origin.y}, ${this.origin.z}) direction=(${this.direction.x}, ${this.direction.y}, ${this.direction.z})]`;
  }
}
