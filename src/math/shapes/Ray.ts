import type { Matrix4 } from '../matrix/Matrix4';
import type { SHAPE_PRIMITIVE_3D } from '../misc/const';
import type { PointData3D } from '../vector/PointData3D';
import { Vector3 } from '../vector/Vector3';
import type { Box } from './Box';
import type { Plane } from './Plane';
import type { Sphere } from './Sphere';

/**
 * The `Ray` object represents a ray in 3D space, defined by an `origin` and a unit-length `direction`
 *
 * Used by raycasters for picking and visibility queries.
 *
 * Math operations follow the unified mutating-default pattern: `a.applyMatrix4(m)` mutates `a`;
 * `a.applyMatrix4(m, out)` writes the result into `out` without mutating `a`.
 *
 * Methods that depend on `direction` being unit length call out the requirement; pass a
 * normalized direction or call `direction.normalize()` after mutating it.
 * @example
 * ```ts
 * const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
 *
 * // Point along the ray at t = 5
 * ray.at(5);
 *
 * // Sphere hit test
 * const hit = ray.intersectSphere(sphere);
 * if (hit) console.log('hit at', hit);
 * ```
 * @see {@link Box} For ray-box hit tests
 * @see {@link Sphere} For ray-sphere hit tests
 * @see {@link Plane} For ray-plane hit tests
 * @category maths
 * @standard
 */
export class Ray {
  /** The origin of the ray */
  public readonly origin: Vector3;
  /** The (unit-length) direction of the ray */
  public readonly direction: Vector3;

  /**
   * The type of the object, mainly used to avoid `instanceof` checks
   * @readonly
   * @default 'ray'
   */
  public readonly type: SHAPE_PRIMITIVE_3D = 'ray';

  /**
   * Creates a new `Ray`
   * @param origin - The origin of the ray
   * @param direction - The unit-length direction of the ray
   */
  constructor(origin?: Vector3, direction?: Vector3) {
    this.origin = origin !== undefined ? origin : new Vector3();
    this.direction = direction !== undefined ? direction : new Vector3(0, 0, -1);
  }

  /**
   * Sets the origin and direction of this ray
   *
   * The direction is assumed to be normalized.
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
   * @returns The new ray
   */
  public clone(): Ray {
    return new Ray().copyFrom(this);
  }

  /**
   * Returns true when `origin` and `direction` match `ray` exactly (no epsilon tolerance)
   * @param ray - The ray to compare with
   * @returns Whether the origin and direction match
   */
  public equals(ray: Ray): boolean {
    return ray.origin.equals(this.origin) && ray.direction.equals(this.direction);
  }

  /**
   * Writes the point at distance `t` along this ray (`origin + direction * t`) into `out`
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
   * The result is clamped to the forward half-line: points behind `origin` collapse to `origin`.
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
   * @param point - The point to measure from
   * @returns The distance to the closest point on this ray
   */
  public distanceToPoint(point: PointData3D): number {
    return Math.sqrt(this.distanceSqToPoint(point));
  }

  /**
   * Returns the squared Euclidean distance from `point` to the closest point on this ray
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
   * Both must be in the same space; the hit point is written into `out` (or a new `Vector3`) in
   * that space. When the ray origin is inside the sphere the exit point is used instead, so
   * callers always get a forward-facing hit. A negative radius marks the sphere as empty
   * ({@link Sphere#radius}) and never intersects, matching {@link Ray#intersectsSphere}.
   *
   * Requires a unit-length `direction`; the quadratic solve measures along it.
   * @param sphere - The sphere to intersect
   * @param out - Optional vector to write into; a new `Vector3` when omitted
   * @returns The entry point (or the exit point from inside), or `null` when the ray misses
   * @see {@link Ray#intersectSphereT} For the parametric `t` of the same hit, without the point.
   */
  public intersectSphere(sphere: Sphere, out?: Vector3): Vector3 | null {
    const t = this.intersectSphereT(sphere);

    return t === -1 ? null : this.at(t, out);
  }

  /**
   * Intersects this ray with `sphere` and returns the hit as a parametric `t` rather than a point
   *
   * The distance form of {@link Ray#intersectSphere}: same hit, same entry / exit rule, but the
   * caller decides whether to materialise a point (`ray.at(t)`). Requires a unit-length
   * `direction`, which also makes `t` the Euclidean distance from `origin` to the hit.
   * @param sphere - The sphere to intersect
   * @returns The parametric `t` of the hit (`>= 0`), or `-1` when the ray misses
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
   * Coplanar rays return the origin.
   * @param plane - The plane to intersect
   * @param out - Optional vector to write into; a new `Vector3` when omitted
   * @returns The hit point, or `null` when there is no intersection
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
   * Returns true when this ray hits `plane`
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
   * Intersects this ray with `box` using the slab method
   *
   * When the ray origin is inside the box, the exit point is returned.
   * @param box - The box to intersect
   * @param out - Optional vector to write into; a new `Vector3` when omitted
   * @returns The entry point, or `null` when there is no intersection
   * @see {@link Ray#intersectBoxT} For the parametric `t` of the same hit, without the point.
   */
  public intersectBox(box: Box, out?: Vector3): Vector3 | null {
    const t = this.intersectBoxT(box);

    return t === -1 ? null : this.at(t, out);
  }

  /**
   * Returns true when this ray hits `box`
   * @param box - The box to test
   * @returns Whether the ray hits the box
   */
  public intersectsBox(box: Box): boolean {
    return this.intersectBoxT(box) !== -1;
  }

  /**
   * Transforms this ray by `matrix`
   *
   * The origin is transformed as a position; the direction is transformed by the rotation portion
   * (and renormalized).
   *
   * Assumes `matrix` is affine (bottom row `[0, 0, 0, 1]`); this is the universal case for
   * `Container3D.worldTransform`. Projection matrices are not supported here.
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
   * Intersects this ray with `box` and returns the hit as a parametric `t` rather than a point
   *
   * The distance form of {@link Ray#intersectBox}: same slab method, same entry / exit rule, but
   * the caller decides whether to materialise a point (`ray.at(t)`). With a unit-length
   * `direction`, `t` is the Euclidean distance from `origin` to the hit.
   * @param box - The box to intersect
   * @returns The parametric `t` of the entry point — of the exit point when the origin is inside
   * the box — or `-1` when the ray misses
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

    // NaN propagation guard for axis-aligned rays (invdir = ±Infinity).
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
   */
  public toString(): string {
    return `[pixi-3d/math:Ray origin=(${this.origin.x}, ${this.origin.y}, ${this.origin.z}) direction=(${this.direction.x}, ${this.direction.y}, ${this.direction.z})]`;
  }
}
