import type { Geometry3D } from '../geometry/Geometry3D';
import type { Box } from '../math/shapes/Box';
import type { Ray } from '../math/shapes/Ray';
import type { Sphere } from '../math/shapes/Sphere';
import { Vector2 } from '../math/vector/Vector2';
import { Vector3 } from '../math/vector/Vector3';
import type { Container3D } from '../scene/Container3D';

/**
 * A hit shape of your own for {@link Container3D#hitVolume}, like `IHitArea` in 2D
 *
 * Any object with these members works, with no base class: an adapter around a physics collider,
 * an analytic capsule, a signed distance field. `Box`, `Sphere` and `Geometry3D` work as they are,
 * with faster built-in tests, so don't wrap them.
 *
 * Everything is in the node's local space, so the volume never deals with transforms.
 * @example
 * ```ts
 * // A flat disc in the node's local XZ plane.
 * class DiscVolume implements IHitVolume3D {
 *   constructor(public radius: number) {}
 *
 *   get boundingRadiusSq(): number {
 *     return this.radius * this.radius;
 *   }
 *
 *   raycast(localRay: Ray, out: HitResult3D): number {
 *     const t = -localRay.origin.y / localRay.direction.y;
 *     if (!Number.isFinite(t) || t < 0) return -1; // behind the origin, or parallel
 *     localRay.at(t, out.point);
 *     if (out.point.x ** 2 + out.point.z ** 2 > this.radius ** 2) return -1;
 *     out.distance = t;
 *     out.normal.set(0, 0, 0);
 *     out.uv.set(0, 0);
 *     out.triangleIndex = -1;
 *     return t;
 *   }
 * }
 *
 * mesh.interactive = true;
 * mesh.hitVolume = new DiscVolume(2);
 * ```
 * @see {@link Container3D#hitVolume} For assigning a volume to a node.
 * @see {@link HitVolume3DInput} For everything else that property accepts.
 * @category events
 * @standard
 */
export interface IHitVolume3D {
  /**
   * Squared radius of a sphere around the node's local origin that encloses the volume
   *
   * A ray that misses this sphere skips {@link IHitVolume3D#raycast | raycast}. It's read on every
   * pick, so it can change with the shape. `Infinity` suits an unbounded shape, at the cost of a
   * `raycast` call on every pick.
   * @example
   * ```ts
   * public readonly boundingRadiusSq = Infinity; // an endless ground plane has no bounds
   * ```
   */
  readonly boundingRadiusSq: number;

  /**
   * Finds where `localRay` first hits the volume
   *
   * `localRay.direction` is unit length, so `t` is the distance to the hit in the node's local
   * units. Hits on nodes of different scale still compare correctly: the picker measures world
   * distance from `out.point`.
   *
   * On a hit, fill `out` as the engine shapes do: `out.point` with `localRay.at(t, out.point)`,
   * `out.distance` with `t`, and, unless the volume has triangles, `out.normal` and `out.uv` with
   * zeros and `out.triangleIndex` with `-1`. On a miss, return `-1`; the picker ignores `out`.
   * @example
   * ```ts
   * public raycast(localRay: Ray, out: HitResult3D): number {
   *   const t = localRay.intersectSphereT(bounds);
   *   if (t === -1) return -1;
   *
   *   localRay.at(t, out.point);
   *   out.distance = t;
   *   out.normal.set(0, 0, 0);
   *   out.uv.set(0, 0);
   *   out.triangleIndex = -1;
   *   return t;
   * }
   * ```
   * @param {Ray} localRay - The pick ray in the node's local space, unit-length direction.
   * @param {HitResult3D} out - Scratch buffer to fill on a hit.
   * @returns The parametric `t` of the closest hit (`>= 0`), or `-1` for a miss.
   */
  raycast(localRay: Ray, out: HitResult3D): number;

  /**
   * Whether a point in the node's local space is inside the volume
   *
   * Only needed for the volume to clip the node's descendants, as every `hitVolume` you set does.
   * Without it, the volume still picks but never clips.
   * @example
   * ```ts
   * public containsPoint(localPoint: Vector3): boolean {
   *   return localPoint.x ** 2 + localPoint.z ** 2 <= radius ** 2 && Math.abs(localPoint.y) <= halfHeight;
   * }
   * ```
   * @param {Vector3} localPoint - The point to test, in the node's local space.
   * @returns Whether the point lies inside the volume.
   */
  containsPoint?(localPoint: Vector3): boolean;
}

/**
 * What {@link Container3D#hitVolume} accepts, like `hitArea` in 2D
 *
 * A string derives the shape from the node:
 *
 * - `'box'`: the node's bounding box.
 * - `'geometry'`: every triangle of the node's own geometry, as stored: skinning and morph targets
 *   don't move it. Hits carry a normal and UV, but every triangle is tested once the ray reaches
 *   the bounding box.
 *
 * An instance gives a shape the node can't work out, in the node's local space:
 *
 * - {@link Box}: an axis-aligned box.
 * - {@link Sphere}: an analytic sphere. A {@link SphereGeometry} works too, but tests every
 *   triangle.
 * - {@link Geometry3D}: a mesh tested per triangle, typically a simpler stand-in for a detailed
 *   model.
 * - {@link IHitVolume3D}: a shape of your own, such as a physics collider.
 * @example
 * ```ts
 * mesh.interactive = true;
 *
 * mesh.hitVolume = 'box';                          // bounding box derived from the node
 * mesh.hitVolume = 'geometry';                     // per triangle, hits carry normal and uv
 * mesh.hitVolume = new Sphere(new Vector3(), 0.5); // the cheapest exact shape for round meshes
 * mesh.hitVolume = new CapsuleGeometry();          // a low-poly stand-in
 * ```
 * @remarks
 * - Only per-triangle shapes (`'geometry'` and `Geometry3D`) give a hit a `normal`, `uv` and
 *   `triangleIndex`. `Box` and `Sphere` hits have zeros and `-1`; an {@link IHitVolume3D} fills in
 *   what it chooses.
 * - Per-triangle tests hit back faces too, and the normal follows the triangle's winding, so it can
 *   face away from the camera.
 * - With the camera inside a box or sphere, a mesh's default bounding box included, the hit is
 *   where the ray leaves it, on the far side.
 * - On a `Mesh3D`, `'box'` and `'geometry'` keep reading the mesh's current geometry, even after a
 *   swap. On a plain `Container3D`, `'box'` measures the subtree once, when set, and unlike
 *   `getLocalBounds()` it includes hidden descendants.
 * - Per-triangle tests need `'triangle-list'` topology and float32 positions. Line, strip and
 *   point geometry, quantised positions (KHR_mesh_quantization), and interleaved geometry
 *   (`interleave: true`) never hit; use `'box'` or a stand-in geometry for those.
 * - `'geometry'` on a plain `Container3D` warns and is ignored, since it has no geometry.
 * @see {@link View3D#raycast} For querying a hit directly rather than through events
 * @category events
 * @standard
 */
export type HitVolume3DInput = 'box' | 'geometry' | Box | Sphere | Geometry3D | IHitVolume3D | null;

/** @internal */
export type HitVolume3D = Box | Sphere | Geometry3D | IHitVolume3D;

/**
 * The buffer a hit test writes into, which an {@link IHitVolume3D} fills in on a hit
 *
 * Everything in it is in the node's local space; events and {@link View3D#raycast} report the
 * closest hit in world space, as a {@link RaycastHit3D}. One buffer is reused for every test, so a
 * hit has to write every field.
 * @example
 * ```ts
 * public raycast(localRay: Ray, out: HitResult3D): number {
 *   const t = localRay.intersectBoxT(bounds);
 *   if (t !== -1) {
 *     localRay.at(t, out.point);
 *     out.distance = t;
 *     out.normal.set(0, 0, 0);
 *     out.uv.set(0, 0);
 *     out.triangleIndex = -1;
 *   }
 *   return t;
 * }
 * ```
 * @category events
 * @standard
 */
export interface HitResult3D {
  /**
   * Hit point, in the node's local space
   * @example
   * ```ts
   * localRay.at(t, out.point);
   * ```
   */
  point: Vector3;
  /**
   * The hit triangle's flat normal, in local space; zero for a shape without triangles
   *
   * Ignored, and reported as zero, while {@link HitResult3D#triangleIndex | triangleIndex} is `-1`.
   * @example
   * ```ts
   * out.normal.set(0, 0, 0);
   * ```
   */
  normal: Vector3;
  /**
   * Texture coordinate at the hit; zero for a shape without triangles
   * @example
   * ```ts
   * out.uv.set(0, 0);
   * ```
   */
  uv: Vector2;
  /**
   * `t`, the distance along the ray to the hit, in the ray's units
   * @example
   * ```ts
   * out.distance = t;
   * ```
   */
  distance: number;
  /**
   * Index of the triangle hit, or `-1` for a shape without triangles
   * @example
   * ```ts
   * out.triangleIndex = -1;
   * ```
   */
  triangleIndex: number;
}

/** @internal */
export function createHitResult3D(): HitResult3D {
  return {
    point: new Vector3(),
    normal: new Vector3(),
    uv: new Vector2(),
    distance: -1,
    triangleIndex: -1,
  };
}

/**
 * A hit in world space: what {@link View3D#raycast} returns, and what every 3D pointer event
 * carries as {@link Event3DFields#hit3D | hit3D}
 * @example
 * ```ts
 * const hit = view3d.raycast(event.global);
 * if (hit) marker.position.copyFrom(hit.point);
 *
 * // The same shape on an event; null when the pointer is over nothing.
 * mesh.on('pointertap', (e) => {
 *   if (e.hit3D) marker.position.copyFrom(e.hit3D.point);
 * });
 * ```
 * @remarks
 * - An event's `hit3D` is reused for later events, so copy out anything you keep; see
 *   {@link Event3DFields}.
 * @see {@link Container3D#hitVolume} For choosing the shape each node is picked against
 * @category events
 * @standard
 */
export interface RaycastHit3D {
  /**
   * The node the hit is reported to
   *
   * That is the node the ray struck, or its nearest interactive ancestor when the struck node
   * isn't interactive (`'auto'` or `'passive'`). The other fields still describe the struck node.
   * @example
   * ```ts
   * const hit = view3d.raycast(e.global);
   * if (hit) select(hit.target);
   * ```
   */
  target: Container3D;
  /**
   * Hit point, in world space
   * @example
   * ```ts
   * if (hit) marker.position.copyFrom(hit.point);
   * ```
   */
  point: Vector3;
  /**
   * Hit point in the local space of the node the ray struck
   *
   * For another node's space, pass `point` to that node's {@link Container3D#toLocal | toLocal}.
   * @example
   * ```ts
   * // Which half of the dial was grabbed, in the dial's own frame?
   * dial.on('pointerdown', (e) => {
   *   grabbedRight = e.hit3D !== null && e.hit3D.localPoint.x > 0;
   * });
   * ```
   */
  localPoint: Vector3;
  /**
   * Distance from the camera to the hit along the ray, in world units
   *
   * For an orthographic camera it is measured from the camera plane.
   * @example
   * ```ts
   * if (hit && hit.distance < reach) pickUp(hit.target);
   * ```
   */
  distance: number;
  /**
   * The hit triangle's flat normal, in world space; zero when `triangleIndex` is `-1`
   * @example
   * ```ts
   * if (hit && hit.normal.y > 0.7) placeTower(hit.point); // flat enough to build on
   * ```
   */
  normal: Vector3;
  /**
   * Texture coordinate at the hit, for a per-triangle shape
   *
   * A geometry without float32 UVs gives the hit's barycentric coordinates in its triangle
   * instead. `Box` and `Sphere` hits give zero.
   * @example
   * ```ts
   * if (hit) paintAt(hit.uv);
   * ```
   */
  uv: Vector2;
  /**
   * Index of the triangle hit, or `-1` for a shape without triangles
   * @example
   * ```ts
   * if (hit && hit.triangleIndex !== -1) highlightFace(hit.target, hit.triangleIndex);
   * ```
   */
  triangleIndex: number;
}

/**
 * Creates an empty {@link RaycastHit3D}, for {@link View3D#raycast} to fill again and again
 *
 * `target` is unset until a raycast hits, so read it only after one returns the hit.
 * @returns The new hit
 * @example
 * ```ts
 * const hover = createRaycastHit3D();
 * app.ticker.add(() => {
 *   if (view3d.raycast(pointer, hover)) cursor3d.position.copyFrom(hover.point);
 * });
 * ```
 * @category events
 * @standard
 */
export function createRaycastHit3D(): RaycastHit3D {
  return {
    target: null!,
    point: new Vector3(),
    localPoint: new Vector3(),
    normal: new Vector3(),
    uv: new Vector2(),
    distance: -1,
    triangleIndex: -1,
  };
}

/** @internal */
export function copyRaycastHit3D(from: RaycastHit3D, to: RaycastHit3D): void {
  to.target = from.target;
  to.point.copyFrom(from.point);
  to.localPoint.copyFrom(from.localPoint);
  to.normal.copyFrom(from.normal);
  to.uv.copyFrom(from.uv);
  to.distance = from.distance;
  to.triangleIndex = from.triangleIndex;
}
