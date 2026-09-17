import type { Matrix4 } from '../matrix/Matrix4';
import type { SHAPE_PRIMITIVE_3D } from '../misc/const';
import type { PointData3D } from '../vector/PointData3D';
import { Vector3 } from '../vector/Vector3';
import type { Plane } from './Plane';
import type { Ray } from './Ray';
import type { Sphere } from './Sphere';

/**
 * The `Box` object represents an axis-aligned bounding box (AABB) in 3D space, defined by `min` and `max` corners
 *
 * Math operations follow the unified mutating-default pattern: `a.union(b)` mutates `a`;
 * `a.union(b, out)` writes the result into `out` without mutating `a`.
 * @example
 * ```ts
 * // Empty box (min = +Infinity, max = -Infinity)
 * const box = new Box();
 *
 * // Grow to enclose a point
 * box.expandByPoint({ x: 1, y: 2, z: 3 });
 *
 * // Test containment
 * box.containsPoint({ x: 0, y: 0, z: 0 });
 *
 * // Transform by a 4x4 matrix
 * box.applyMatrix4(worldTransform);
 * ```
 * @see {@link Sphere} For the bounding-sphere counterpart
 * @see {@link Plane} For half-space intersection tests
 * @see {@link Ray} For ray-box hit tests
 * @category maths
 * @standard
 */
export class Box {
  /** The minimum corner of the box */
  public readonly min: Vector3;
  /** The maximum corner of the box */
  public readonly max: Vector3;

  /**
   * The type of the object, mainly used to avoid `instanceof` checks
   * @readonly
   * @default 'box'
   */
  public readonly type: SHAPE_PRIMITIVE_3D = 'box';

  /**
   * Creates a new `Box`
   *
   * Defaults to an empty box (`min = +Infinity`, `max = -Infinity`) so any subsequent
   * `expandByPoint` call produces a tight bound.
   * @param min - The minimum corner of the box
   * @param max - The maximum corner of the box
   */
  constructor(min?: Vector3, max?: Vector3) {
    this.min = min !== undefined ? min : new Vector3(Infinity, Infinity, Infinity);
    this.max = max !== undefined ? max : new Vector3(-Infinity, -Infinity, -Infinity);
  }

  /**
   * Creates a box centred at `center` with the given full `size`
   *
   * A number produces a uniform cube; a point gives per-axis extents.
   * @param center - The center of the box
   * @param size - The full size of the box, uniform or per-axis
   * @returns The new box
   */
  public static fromCenterSize(center: PointData3D, size: number | PointData3D): Box {
    const hx = (typeof size === 'number' ? size : size.x) * 0.5;
    const hy = (typeof size === 'number' ? size : size.y) * 0.5;
    const hz = (typeof size === 'number' ? size : size.z) * 0.5;

    return new Box(
      new Vector3(center.x - hx, center.y - hy, center.z - hz),
      new Vector3(center.x + hx, center.y + hy, center.z + hz),
    );
  }

  /**
   * Sets the corners of this box to `min` and `max`
   * @param min - The minimum corner
   * @param max - The maximum corner
   * @returns This box for chaining
   */
  public set(min: PointData3D, max: PointData3D): this {
    this.min.copyFrom(min);
    this.max.copyFrom(max);

    return this;
  }

  /**
   * Copies `box` into this box
   * @param box - The box to copy from
   * @returns This box for chaining
   */
  public copyFrom(box: Box): this {
    this.min.copyFrom(box.min);
    this.max.copyFrom(box.max);

    return this;
  }

  /**
   * Copies this box into `target` and returns it
   * @param target - The box to copy into
   * @returns The given `target`
   */
  public copyTo<T extends Box>(target: T): T {
    target.min.copyFrom(this.min);
    target.max.copyFrom(this.max);

    return target;
  }

  /**
   * Creates a new `Box` with the same corners
   * @returns The new box
   */
  public clone(): Box {
    return new Box().copyFrom(this);
  }

  /**
   * Resets this box to the empty state (`min = +Infinity`, `max = -Infinity`)
   * @returns This box for chaining
   */
  public makeEmpty(): this {
    this.min.x = this.min.y = this.min.z = Infinity;
    this.max.x = this.max.y = this.max.z = -Infinity;

    return this;
  }

  /**
   * Returns true when this box has no volume
   *
   * A box is empty when any axis has `max < min`, which is more robust than a volume check (two
   * negative axes would yield positive volume).
   * @returns Whether this box is empty
   */
  public isEmpty(): boolean {
    return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
  }

  /**
   * Returns true when both corners match `box` exactly (no epsilon tolerance)
   * @param box - The box to compare with
   * @returns Whether both corners match
   */
  public equals(box: Box): boolean {
    return box.min.equals(this.min) && box.max.equals(this.max);
  }

  /**
   * Grows this box to enclose `point`
   * @param point - The point to enclose
   * @param out - Target to write the result into instead of mutating this box
   * @returns The result box for chaining
   */
  public expandByPoint(point: PointData3D, out: Box = this): this {
    if (out !== this) out.copyFrom(this);
    out.min.min(point);
    out.max.max(point);

    return out as this;
  }

  /**
   * Grows this box to enclose `box`
   * @param box - The box to enclose
   * @param out - Target to write the result into instead of mutating this box
   * @returns The result box for chaining
   */
  public union(box: Box, out: Box = this): this {
    if (out !== this) out.copyFrom(this);
    out.min.min(box.min);
    out.max.max(box.max);

    return out as this;
  }

  /**
   * Writes the center of this box into `out` (or a new `Vector3`)
   *
   * Empty boxes return `(0, 0, 0)`.
   * @param out - Optional vector to write into; a new `Vector3` when omitted
   * @returns The center of this box
   */
  public getCenter(out?: Vector3): Vector3 {
    out ||= new Vector3();
    if (this.isEmpty()) return out.set(0, 0, 0);
    out.x = (this.min.x + this.max.x) * 0.5;
    out.y = (this.min.y + this.max.y) * 0.5;
    out.z = (this.min.z + this.max.z) * 0.5;

    return out;
  }

  /**
   * Writes the size (`max - min`) of this box into `out` (or a new `Vector3`)
   *
   * Empty boxes return `(0, 0, 0)`.
   * @param out - Optional vector to write into; a new `Vector3` when omitted
   * @returns The size of this box
   */
  public getSize(out?: Vector3): Vector3 {
    out ||= new Vector3();
    if (this.isEmpty()) return out.set(0, 0, 0);
    out.x = this.max.x - this.min.x;
    out.y = this.max.y - this.min.y;
    out.z = this.max.z - this.min.z;

    return out;
  }

  /**
   * Returns the Euclidean distance from `point` to the closest point on this box (`0` if inside)
   * @param point - The point to measure from
   * @returns The distance to the closest point on this box
   */
  public distanceToPoint(point: PointData3D): number {
    return _scratchPoint.copyFrom(point).clamp(this.min, this.max).distanceTo(point);
  }

  /**
   * Writes the closest point on this box to `point` into `out` (or a new `Vector3`)
   * @param point - The point to clamp
   * @param out - Optional vector to write into; a new `Vector3` when omitted
   * @returns The closest point on this box
   */
  public clampPoint(point: PointData3D, out?: Vector3): Vector3 {
    out ||= new Vector3();

    return out.copyFrom(point).clamp(this.min, this.max);
  }

  /**
   * Returns true when `point` is inside this box (boundary is inclusive)
   * @param point - The point to test
   * @returns Whether the point is inside this box
   */
  public containsPoint(point: PointData3D): boolean {
    return !(
      point.x < this.min.x ||
      point.x > this.max.x ||
      point.y < this.min.y ||
      point.y > this.max.y ||
      point.z < this.min.z ||
      point.z > this.max.z
    );
  }

  /**
   * Returns true when `box` is fully inside this box (boundary is inclusive)
   * @param box - The box to test
   * @returns Whether the box is fully inside this box
   */
  public containsBox(box: Box): boolean {
    return (
      this.min.x <= box.min.x &&
      box.max.x <= this.max.x &&
      this.min.y <= box.min.y &&
      box.max.y <= this.max.y &&
      this.min.z <= box.min.z &&
      box.max.z <= this.max.z
    );
  }

  /**
   * Returns true when this box and `box` overlap
   * @param box - The box to test
   * @returns Whether the boxes overlap
   */
  public intersectsBox(box: Box): boolean {
    return !(
      box.max.x < this.min.x ||
      box.min.x > this.max.x ||
      box.max.y < this.min.y ||
      box.min.y > this.max.y ||
      box.max.z < this.min.z ||
      box.min.z > this.max.z
    );
  }

  /**
   * Returns true when this box and `sphere` overlap (uses the closest-point clamp test)
   * @param sphere - The sphere to test
   * @returns Whether the box and sphere overlap
   */
  public intersectsSphere(sphere: Sphere): boolean {
    if (sphere.radius < 0) return false;
    this.clampPoint(sphere.center, _scratchPoint);

    return _scratchPoint.distanceToSquared(sphere.center) <= sphere.radius * sphere.radius;
  }

  /**
   * Returns true when this box straddles `plane`
   * @param plane - The plane to test
   * @returns Whether the box straddles the plane
   */
  public intersectsPlane(plane: Plane): boolean {
    let min: number;
    let max: number;

    if (plane.normal.x > 0) {
      min = plane.normal.x * this.min.x;
      max = plane.normal.x * this.max.x;
    } else {
      min = plane.normal.x * this.max.x;
      max = plane.normal.x * this.min.x;
    }

    if (plane.normal.y > 0) {
      min += plane.normal.y * this.min.y;
      max += plane.normal.y * this.max.y;
    } else {
      min += plane.normal.y * this.max.y;
      max += plane.normal.y * this.min.y;
    }

    if (plane.normal.z > 0) {
      min += plane.normal.z * this.min.z;
      max += plane.normal.z * this.max.z;
    } else {
      min += plane.normal.z * this.max.z;
      max += plane.normal.z * this.min.z;
    }

    return min <= -plane.constant && max >= -plane.constant;
  }

  /**
   * Returns true when `ray` enters this box
   * @param ray - The ray to test
   * @returns Whether the ray enters this box
   */
  public intersectsRay(ray: Ray): boolean {
    return ray.intersectsBox(this);
  }

  /**
   * Transforms this box by `matrix` and rebuilds the AABB
   *
   * Empty boxes are left empty.
   *
   * Uses the Akenine-Möller center/half-extent transform, which assumes `matrix` is affine
   * (bottom row `[0, 0, 0, 1]`); this is the universal case for `Container3D.worldTransform`.
   * Projection matrices are not supported here.
   * @param matrix - The affine matrix to transform by
   * @param out - Target to write the result into instead of mutating this box
   * @returns The result box for chaining
   */
  public applyMatrix4(matrix: Matrix4, out: Box = this): this {
    if (out !== this) out.copyFrom(this);
    if (out.isEmpty()) return out as this;

    const e = matrix.elements;

    const cx = (out.min.x + out.max.x) * 0.5;
    const cy = (out.min.y + out.max.y) * 0.5;
    const cz = (out.min.z + out.max.z) * 0.5;
    const hx = (out.max.x - out.min.x) * 0.5;
    const hy = (out.max.y - out.min.y) * 0.5;
    const hz = (out.max.z - out.min.z) * 0.5;

    const ncx = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
    const ncy = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
    const ncz = e[2] * cx + e[6] * cy + e[10] * cz + e[14];

    const nhx = Math.abs(e[0]) * hx + Math.abs(e[4]) * hy + Math.abs(e[8]) * hz;
    const nhy = Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz;
    const nhz = Math.abs(e[2]) * hx + Math.abs(e[6]) * hy + Math.abs(e[10]) * hz;

    out.min.set(ncx - nhx, ncy - nhy, ncz - nhz);
    out.max.set(ncx + nhx, ncy + nhy, ncz + nhz);

    return out as this;
  }

  /**
   * Writes the AABB of this box into `out` (or a new `Box`)
   * @param out - Optional box to write into; a new `Box` when omitted
   * @returns The bounds of this box
   */
  public getBounds(out?: Box): Box {
    out ||= new Box();

    return out.copyFrom(this);
  }

  /** The width (X extent) of this box */
  public get width(): number {
    return this.max.x - this.min.x;
  }

  /** The height (Y extent) of this box */
  public get height(): number {
    return this.max.y - this.min.y;
  }

  /** The depth (Z extent) of this box */
  public get depth(): number {
    return this.max.z - this.min.z;
  }

  /**
   * Returns a string representation of this box
   * @returns A string in the form `[pixi-3d/math:Box min=(0, 0, 0) max=(1, 1, 1)]`
   */
  public toString(): string {
    return `[pixi-3d/math:Box min=(${this.min.x}, ${this.min.y}, ${this.min.z}) max=(${this.max.x}, ${this.max.y}, ${this.max.z})]`;
  }
}

const _scratchPoint = new Vector3();
