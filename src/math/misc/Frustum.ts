import type { Matrix4 } from '../matrix/Matrix4';
import type { Box } from '../shapes/Box';
import { Plane } from '../shapes/Plane';
import type { Sphere } from '../shapes/Sphere';
import type { PointData3D } from '../vector/PointData3D';

/**
 * A volume bounded by six planes that face inward, most often the volume a camera sees
 *
 * Each {@link Camera3D} has one as {@link Camera3D#frustum}. Test against it to skip work for
 * things the camera can't see, or build your own from a matrix or from planes to cull against
 * another volume.
 * @example
 * ```ts
 * const onScreen = enemies.filter((enemy: Mesh3D) =>
 *   camera.frustum.intersectsSphere(enemy.boundingSphere),
 * );
 * ```
 * @category maths
 * @standard
 */
export class Frustum {
  private readonly _planes: Float32Array;

  /**
   * Creates a new `Frustum`
   *
   * A plane left out defaults to `new Plane()`: normal `(1, 0, 0)`, constant `0`.
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
   * The six planes as 24 floats, `[nx, ny, nz, c]` per plane in {@link Frustum#getPlane} order
   *
   * This is the frustum's own storage, not a copy: writing to it changes the frustum. Pass it to
   * your own shader to cull on the GPU.
   * @example
   * ```ts
   * device.queue.writeBuffer(frustumBuffer, 0, camera.frustum.planesData);
   * ```
   * @advanced
   */
  public get planesData(): Float32Array {
    return this._planes;
  }

  /**
   * Sets the six planes of this frustum
   *
   * Each plane's normal must be unit length and point into the volume.
   * @example
   * ```ts
   * camera.cullFrustum = new Frustum().set(
   *   new Plane(new Vector3(1, 0, 0), 20),
   *   new Plane(new Vector3(-1, 0, 0), 20),
   *   new Plane(new Vector3(0, 1, 0), 0),
   *   new Plane(new Vector3(0, -1, 0), 10),
   *   new Plane(new Vector3(0, 0, 1), 20),
   *   new Plane(new Vector3(0, 0, -1), 20),
   * );
   * ```
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
   * Sets the six planes to the volume that `matrix` maps onto the screen
   *
   * The planes come out in the space the matrix maps from: world space for a view-projection
   * matrix, view space for a projection matrix alone. They are normalized, so distances to them are
   * in that space's units. The matrix must map depth to `[-1, 1]`, as
   * {@link Matrix4#makePerspective} and {@link Matrix4#makeOrthographic} do.
   * @example
   * ```ts
   * const spotlightView = new Frustum().setFromProjectionMatrix(securityCamera.viewProjection);
   * const spotted = spotlightView.containsPoint(player.position);
   * ```
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
   * @example
   * ```ts
   * frozenFrustum.copyFrom(camera.frustum);
   * camera.cullFrustum = frozenFrustum;
   * ```
   * @param frustum - The frustum to copy from
   * @returns This frustum for chaining
   */
  public copyFrom(frustum: Frustum): this {
    this._planes.set(frustum._planes);

    return this;
  }

  /**
   * Copies this frustum into `target` and returns it
   * @example
   * ```ts
   * camera.frustum.copyTo(debugFrustum);
   * ```
   * @param target - The frustum to copy into
   * @returns The given `target`
   */
  public copyTo<T extends Frustum>(target: T): T {
    target._planes.set(this._planes);

    return target;
  }

  /**
   * Creates a new `Frustum` with the same planes
   * @example
   * ```ts
   * camera.cullFrustum = camera.frustum.clone();
   * ```
   * @returns The new frustum
   */
  public clone(): Frustum {
    return new Frustum().copyFrom(this);
  }

  /**
   * Returns true when all six planes match `frustum` exactly, with no tolerance
   * @example
   * ```ts
   * if (!camera.frustum.equals(lastFrustum)) {
   *   lastFrustum.copyFrom(camera.frustum);
   *   refreshVisibleList();
   * }
   * ```
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
   * Writes plane `index` into `out` and returns it
   *
   * After {@link Frustum#setFromProjectionMatrix} the planes are ordered right, left, bottom, top,
   * far, near.
   * @example
   * ```ts
   * const near = camera.frustum.getPlane(5, new Plane());
   * const distanceInFront = near.distanceToPoint(pickup.position);
   * ```
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
   * @example
   * ```ts
   * marker.visible = !camera.frustum.containsPoint(objective.position);
   * ```
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
   *
   * Like most culling tests it errs towards true: a box just outside a corner of the frustum can
   * pass, but a box that overlaps it never fails.
   * @example
   * ```ts
   * building.getLocalBounds(bounds).applyMatrix4(building.worldTransform);
   * if (camera.frustum.intersectsBox(bounds)) updateWindowLights(building);
   * ```
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
   * Like {@link Frustum#intersectsBox} it errs towards true near the frustum's corners. Empty
   * spheres (`radius < 0`) never intersect.
   * @example
   * ```ts
   * if (camera.frustum.intersectsSphere(enemy.boundingSphere)) enemy.updateAnimation(dt);
   * ```
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
   * @example
   * ```ts
   * console.log(`${camera.frustum}`);
   * ```
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
