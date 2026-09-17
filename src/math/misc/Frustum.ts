import type { Matrix4 } from '../matrix/Matrix4';
import type { Box } from '../shapes/Box';
import { Plane } from '../shapes/Plane';
import type { Sphere } from '../shapes/Sphere';
import type { PointData3D } from '../vector/PointData3D';

/**
 * The `Frustum` object represents the convex volume bounded by six inward-facing clipping planes
 *
 * Frusta are typically built from a camera's view-projection matrix and used for visibility tests
 * — meshes that fail every `intersects*` call can be skipped during rendering.
 *
 * Planes face inward, so a point is "inside" when it produces a non-negative signed distance
 * against every plane. Internally the six planes are packed as 24 floats (`[nx, ny, nz, c]`) to
 * keep intersection tests in tight scalar loops without per-plane allocations.
 * @example
 * ```ts
 * // Build from a camera's view-projection matrix.
 * const frustum = new Frustum().setFromProjectionMatrix(camera.viewProjection);
 *
 * frustum.containsPoint({ x: 0, y: 0, z: -10 });
 * frustum.intersectsSphere(sphere);
 * frustum.intersectsBox(box);
 * ```
 * @see {@link Plane} For the half-spaces enclosing the frustum
 * @see {@link Box} For axis-aligned bounding box intersections
 * @see {@link Sphere} For bounding sphere intersections
 * @category maths
 * @standard
 */
export class Frustum {
  // Six planes packed as `[nx, ny, nz, c]` each (24 floats). Storing the planes inline avoids
  // allocating six `Plane` objects per frustum and keeps the hot-path intersection tests on a
  // single contiguous buffer.
  private readonly _planes: Float32Array;

  /**
   * Creates a new `Frustum`
   *
   * Defaults to six planes with normal `(1, 0, 0)` and constant `0`, matching the default of
   * `new Plane()`. Use {@link Frustum#setFromProjectionMatrix} to populate from a camera's
   * view-projection matrix.
   * @param p0 - The first plane
   * @param p1 - The second plane
   * @param p2 - The third plane
   * @param p3 - The fourth plane
   * @param p4 - The fifth plane
   * @param p5 - The sixth plane
   */
  constructor(p0?: Plane, p1?: Plane, p2?: Plane, p3?: Plane, p4?: Plane, p5?: Plane) {
    this._planes = new Float32Array(24);
    for (let i = 0; i < 24; i += 4) this._planes[i] = 1;

    if (p0 !== undefined) this._writePlane(0, p0);
    if (p1 !== undefined) this._writePlane(1, p1);
    if (p2 !== undefined) this._writePlane(2, p2);
    if (p3 !== undefined) this._writePlane(3, p3);
    if (p4 !== undefined) this._writePlane(4, p4);
    if (p5 !== undefined) this._writePlane(5, p5);
  }

  /**
   * The six planes packed as 24 floats — `[nx, ny, nz, c]` × 6, inward-facing and normalized
   *
   * This is the backing store, not a copy; the GPU cull compute uploads it directly.
   */
  public get planesData(): Float32Array {
    return this._planes;
  }

  /**
   * Sets the six planes of this frustum
   * @param p0 - The first plane
   * @param p1 - The second plane
   * @param p2 - The third plane
   * @param p3 - The fourth plane
   * @param p4 - The fifth plane
   * @param p5 - The sixth plane
   * @returns This frustum for chaining
   */
  public set(p0: Plane, p1: Plane, p2: Plane, p3: Plane, p4: Plane, p5: Plane): this {
    this._writePlane(0, p0);
    this._writePlane(1, p1);
    this._writePlane(2, p2);
    this._writePlane(3, p3);
    this._writePlane(4, p4);
    this._writePlane(5, p5);

    return this;
  }

  /**
   * Extracts the six clipping planes from `matrix` (typically a view-projection matrix)
   *
   * Planes are normalized so signed distances returned by intersection tests are in world units.
   * Plane order is right, left, top, bottom, far, near. All planes face inward.
   * @param matrix - The matrix to extract clipping planes from
   * @returns This frustum for chaining
   */
  public setFromProjectionMatrix(matrix: Matrix4): this {
    const me = matrix.elements;
    const me0 = me[0];
    const me1 = me[1];
    const me2 = me[2];
    const me3 = me[3];
    const me4 = me[4];
    const me5 = me[5];
    const me6 = me[6];
    const me7 = me[7];
    const me8 = me[8];
    const me9 = me[9];
    const me10 = me[10];
    const me11 = me[11];
    const me12 = me[12];
    const me13 = me[13];
    const me14 = me[14];
    const me15 = me[15];

    const planes = this._planes;
    _writeNormalized(planes, 0, me3 - me0, me7 - me4, me11 - me8, me15 - me12);
    _writeNormalized(planes, 4, me3 + me0, me7 + me4, me11 + me8, me15 + me12);
    _writeNormalized(planes, 8, me3 + me1, me7 + me5, me11 + me9, me15 + me13);
    _writeNormalized(planes, 12, me3 - me1, me7 - me5, me11 - me9, me15 - me13);
    _writeNormalized(planes, 16, me3 - me2, me7 - me6, me11 - me10, me15 - me14);
    _writeNormalized(planes, 20, me3 + me2, me7 + me6, me11 + me10, me15 + me14);

    return this;
  }

  /**
   * Copies `frustum` into this frustum
   * @param frustum - The frustum to copy from
   * @returns This frustum for chaining
   */
  public copyFrom(frustum: Frustum): this {
    this._planes.set(frustum._planes);

    return this;
  }

  /**
   * Copies this frustum into `target` and returns it
   * @param target - The frustum to copy into
   * @returns The given `target`
   */
  public copyTo<T extends Frustum>(target: T): T {
    target._planes.set(this._planes);

    return target;
  }

  /**
   * Creates a new `Frustum` with the same planes
   * @returns The new frustum
   */
  public clone(): Frustum {
    return new Frustum().copyFrom(this);
  }

  /**
   * Returns true when all six planes match `frustum` exactly (no epsilon tolerance)
   * @param frustum - The frustum to compare with
   * @returns Whether all six planes match
   */
  public equals(frustum: Frustum): boolean {
    const a = this._planes;
    const b = frustum._planes;
    for (let i = 0; i < 24; i++) {
      if (a[i] !== b[i]) return false;
    }

    return true;
  }

  /**
   * Writes plane `index` into `out` (or a new `Plane`) and returns it
   *
   * After {@link Frustum#setFromProjectionMatrix} the planes are ordered right, left, top, bottom,
   * far, near.
   * @param index - The plane index, `0` to `5`
   * @param out - Optional plane to write into; a new `Plane` when omitted
   * @returns The written plane
   */
  public getPlane(index: number, out?: Plane): Plane {
    out ||= new Plane();
    const offset = index * 4;
    out.normal.set(this._planes[offset], this._planes[offset + 1], this._planes[offset + 2]);
    out.constant = this._planes[offset + 3];

    return out;
  }

  /**
   * Returns true when `point` lies inside this frustum (boundary is inclusive)
   * @param point - The point to test
   * @returns Whether the point is inside this frustum
   */
  public containsPoint(point: PointData3D): boolean {
    const planes = this._planes;
    const px = point.x;
    const py = point.y;
    const pz = point.z;

    for (let i = 0; i < 24; i += 4) {
      if (planes[i] * px + planes[i + 1] * py + planes[i + 2] * pz + planes[i + 3] < 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * Returns true when `box` and this frustum overlap
   * @param box - The box to test
   * @returns Whether the box and this frustum overlap
   */
  public intersectsBox(box: Box): boolean {
    const planes = this._planes;
    const minX = box.min.x;
    const minY = box.min.y;
    const minZ = box.min.z;
    const maxX = box.max.x;
    const maxY = box.max.y;
    const maxZ = box.max.z;

    for (let i = 0; i < 24; i += 4) {
      const nx = planes[i];
      const ny = planes[i + 1];
      const nz = planes[i + 2];
      const px = nx > 0 ? maxX : minX;
      const py = ny > 0 ? maxY : minY;
      const pz = nz > 0 ? maxZ : minZ;

      if (nx * px + ny * py + nz * pz + planes[i + 3] < 0) return false;
    }

    return true;
  }

  /**
   * Returns true when `sphere` and this frustum overlap
   *
   * Empty spheres (`radius < 0`) never intersect.
   * @param sphere - The sphere to test
   * @returns Whether the sphere and this frustum overlap
   */
  public intersectsSphere(sphere: Sphere): boolean {
    if (sphere.radius < 0) return false;
    const planes = this._planes;
    const cx = sphere.center.x;
    const cy = sphere.center.y;
    const cz = sphere.center.z;
    const negRadius = -sphere.radius;

    for (let i = 0; i < 24; i += 4) {
      if (planes[i] * cx + planes[i + 1] * cy + planes[i + 2] * cz + planes[i + 3] < negRadius) {
        return false;
      }
    }

    return true;
  }

  /**
   * Returns a string representation of this frustum
   * @returns The string `[pixi-3d/math:Frustum]`
   */
  public toString(): string {
    return `[pixi-3d/math:Frustum]`;
  }

  private _writePlane(index: number, plane: Plane): void {
    const offset = index * 4;
    this._planes[offset] = plane.normal.x;
    this._planes[offset + 1] = plane.normal.y;
    this._planes[offset + 2] = plane.normal.z;
    this._planes[offset + 3] = plane.constant;
  }
}

function _writeNormalized(planes: Float32Array, offset: number, x: number, y: number, z: number, w: number): void {
  const inv = 1 / Math.sqrt(x * x + y * y + z * z);
  planes[offset] = x * inv;
  planes[offset + 1] = y * inv;
  planes[offset + 2] = z * inv;
  planes[offset + 3] = w * inv;
}
