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
 * an analytic capsule, a signed distance field. The engine's own `Box`, `Sphere` and `Geometry3D`
 * have faster built-in tests and don't implement it.
 *
 * Everything is in the node's local space. The picker moves the ray or point into that space
 * first, so the volume never deals with transforms.
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
   * The picker reads it on every pick and skips the volume when the ray misses that sphere, so a
   * value that follows a changing shape takes effect at once. `Infinity` never skips, which suits an
   * unbounded shape, at the cost of calling {@link IHitVolume3D#raycast | raycast} on every pick.
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
   * units. Those differ between nodes of different scale, which is fine: the picker compares hits
   * by their world-space distance, worked out from `out.point`.
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
 * A string derives the shape from the node, once, when you set it:
 *
 * - `'box'`: the node's bounding box.
 * - `'geometry'`: every triangle of the node's own geometry. Exact, and hits carry a normal and UV,
 *   but every triangle is tested once the ray reaches the bounding box.
 *
 * An instance gives a shape the node can't work out, in the node's local space:
 *
 * - {@link Box}: an axis-aligned box.
 * - {@link Sphere}: the analytic sphere from `math/shapes`. A {@link SphereGeometry} works too, but
 *   tests every triangle.
 * - {@link Geometry3D}: a mesh tested per triangle, typically a simpler stand-in for a detailed
 *   model. Any subclass works, {@link CapsuleGeometry} and {@link CylinderGeometry} included.
 * - {@link IHitVolume3D}: a shape of your own, such as a physics collider.
 *
 * `null` means no shape of your own: an interactive {@link Mesh3D} uses its geometry's bounding
 * box, and a plain {@link Container3D} only hears events from its children.
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
 * - The shape only counts while the node can be picked: `eventMode` `'static'` or `'dynamic'`, or
 *   `'passive'` or `'auto'` under an interactive ancestor, and no ancestor with `eventMode: 'none'`
 *   or `interactiveChildren: false`. 2D `hitArea` works the same way.
 * - Only per-triangle shapes (`'geometry'` and `Geometry3D`) give a hit a `normal`, `uv` and
 *   `triangleIndex`. `Box` and `Sphere` hits have zeros and `-1`; an {@link IHitVolume3D} fills in
 *   what it chooses.
 * - On a `Mesh3D`, `'box'` and `'geometry'` follow edits to the geometry and a swap to a new one.
 *   On a plain `Container3D`, `'box'` measures the subtree once, when set, and unlike
 *   `getLocalBounds()` it includes hidden descendants.
 * - Per-triangle tests need `'triangle-list'` topology and float32 positions. Line, strip and
 *   point geometry, and quantised positions (KHR_mesh_quantization), never hit; use `'box'` or a
 *   stand-in geometry for those.
 * - `'geometry'` on a plain `Container3D` warns and is ignored, since it has no geometry.
 * - A `Geometry3D` given as the shape needs its `bounds3D` filled in: the ray is tested against
 *   it before the triangles.
 * @see {@link View3D#raycast} For querying a hit directly rather than through events
 * @category events
 * @standard
 */
export type HitVolume3DInput = 'box' | 'geometry' | Box | Sphere | Geometry3D | IHitVolume3D | null;

/**
 * The shape a node is picked against, once `resolveHitVolume` has turned strings into shapes
 * @internal
 * @see {@link HitVolume3DInput} The form users assign
 */
export type HitVolume3D = Box | Sphere | Geometry3D | IHitVolume3D;

/**
 * The buffer a hit test writes into, which an {@link IHitVolume3D} fills in on a hit
 *
 * Everything in it is in the node's local space. The picker turns the closest hit into the
 * world-space {@link RaycastHit3D} that events and {@link View3D#raycast} report. Each View reuses
 * one buffer for every test, so a hit has to write every field.
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
   * The picker keeps it only when {@link HitResult3D#triangleIndex | triangleIndex} isn't `-1`.
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
   *
   * The picker reads `-1` as "no surface data" and reports a zero normal.
   * @example
   * ```ts
   * out.triangleIndex = -1;
   * ```
   */
  triangleIndex: number;
}

/**
 * Creates an empty {@link HitResult3D}
 * @returns A zeroed buffer with `distance` and `triangleIndex` at their `-1` miss sentinels
 * @internal
 */
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
 * - `raycast` returns a new object on every call. An event's `hit3D` is reused for later events,
 *   as pixi's `event.global` is, so copy out anything you keep.
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
   * Hit point in the struck node's local space
   *
   * The struck node is usually `target`; for a hit on a non-interactive (`'auto'` or `'passive'`)
   * node it is that node, while `target` is its nearest interactive ancestor. This is the 3D
   * counterpart of 2D's `FederatedMouseEvent.getLocalPosition` for the struck node; for any other
   * node, transform `point` with {@link Container3D#toLocal}. There is no version that takes a
   * node, because a 3D pointer is a ray and only becomes a point where it hits something.
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
 * Allocates a {@link RaycastHit3D} with zeroed surface data
 *
 * `target` is filled by the pick that succeeds; a fresh hit is never surfaced before one does.
 * @returns The new hit
 * @internal
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

/**
 * Copies every field of `from` into `to`, vectors by value
 * @param from - Hit to read
 * @param to - Hit to overwrite
 * @internal
 */
export function copyRaycastHit3D(from: RaycastHit3D, to: RaycastHit3D): void {
  to.target = from.target;
  to.point.copyFrom(from.point);
  to.localPoint.copyFrom(from.localPoint);
  to.normal.copyFrom(from.normal);
  to.uv.copyFrom(from.uv);
  to.distance = from.distance;
  to.triangleIndex = from.triangleIndex;
}
