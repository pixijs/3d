import type { Geometry3D } from '../geometry/Geometry3D';
import type { Box } from '../math/shapes/Box';
import type { Ray } from '../math/shapes/Ray';
import type { Sphere } from '../math/shapes/Sphere';
import { Vector2 } from '../math/vector/Vector2';
import { Vector3 } from '../math/vector/Vector3';
import type { Container3D } from '../scene/Container3D';

/**
 * Structural contract for a user-supplied hit volume — the 3D counterpart of 2D's `IHitArea`
 *
 * Any object with these members can be assigned to {@link Container3D#hitVolume}: a physics-engine
 * collider adapter, an analytic SDF, a capsule — no engine base class required. The engine's own
 * shapes (`Box` / `Sphere` / `Geometry3D`) keep their dedicated fast paths and do not implement this
 * interface.
 *
 * All queries are in the **node's local space**; the picker transforms the world ray / point by the
 * node's inverse world transform before calling in, so the volume itself never deals with transforms.
 * @example
 * ```ts
 * // A flat analytic disc in the node's local XZ plane.
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
   * Local-space conservative bounding sphere radius², centred on the node's origin
   *
   * Read on every pick for the broadphase, so a value that tracks a mutating shape is picked up
   * immediately. `Infinity` opts the volume out of broadphase rejection entirely — correct for
   * unbounded shapes, at the cost of running {@link IHitVolume3D#raycast | raycast} on every pick.
   */
  readonly boundingRadiusSq: number;

  /**
   * Nearest intersection of `localRay` with this volume, in the node's local space
   *
   * `localRay.direction` is unit length (the picker renormalises after the inverse-world transform),
   * so `t` is the Euclidean distance to the hit *in local units*. Under node scale those units differ
   * per node — `t` values are never compared across volumes; the picker converts `out.point` to world
   * space and sorts on true world distance, so no cross-volume consistency is required.
   *
   * On a hit, fill `out` exactly as the engine volumes do: `out.point` = the local hit point
   * (`localRay.at(t, out.point)`), `out.distance` = `t`, and — unless the volume has real per-triangle
   * surface data — `out.normal` and `out.uv` zeroed with `out.triangleIndex = -1`. On a miss, return
   * `-1` and leave `out` untouched.
   * @param {Ray} localRay - The pick ray in the node's local space, unit-length direction.
   * @param {HitResult3D} out - Scratch buffer to fill on a hit; leave untouched on a miss.
   * @returns The parametric `t` of the closest hit (`>= 0`), or `-1` for a miss.
   */
  raycast(localRay: Ray, out: HitResult3D): number;

  /**
   * Optional point-containment test, in the node's local space
   *
   * Required only for the volume to clip descendants when set as an ancestor's explicit
   * {@link Container3D#hitVolume | hitVolume}; without it the volume picks normally but never clips.
   * @param {Vector3} localPoint - The point to test, in the node's local space.
   * @returns Whether the point lies inside the volume.
   */
  containsPoint?(localPoint: Vector3): boolean;
}

/**
 * Hit shape accepted by {@link Container3D#hitVolume}, the 3D counterpart of 2D `hitArea`
 *
 * A string asks the node to derive a volume from itself, resolved once when the property is set:
 *
 * - `'box'` — the node's AABB.
 * - `'geometry'` — per-triangle against the node's own geometry.
 *
 * An instance supplies a volume the node cannot infer, expressed in the node's local space:
 *
 * - {@link Box} — an axis-aligned box.
 * - {@link Sphere} — the analytic shape from `math/shapes`, not {@link SphereGeometry} (which also works, but tests
 *   every triangle).
 * - {@link Geometry3D} — a per-triangle proxy mesh; any subclass qualifies, {@link CapsuleGeometry} and
 *   {@link CylinderGeometry} included.
 * - {@link IHitVolume3D} — any object implementing the structural interface, for shapes the engine
 *   doesn't ship: physics-collider adapters, SDFs, analytic capsules.
 *
 * `null` means no explicit shape: an interactive {@link Mesh3D} falls back to its live geometry AABB, and a plain
 * {@link Container3D} is bubble-only.
 * @example
 * ```ts
 * mesh.interactive = true;
 *
 * mesh.hitVolume = 'box';                          // AABB derived from the node
 * mesh.hitVolume = 'geometry';                     // per-triangle, hits carry normal / uv
 * mesh.hitVolume = new Sphere(new Vector3(), 0.5); // analytic, cheapest exact volume for round meshes
 * mesh.hitVolume = new CapsuleGeometry();          // low-poly proxy collider
 * ```
 * @remarks
 * - The shape only takes part in picking while the node is registered (`eventMode` static / dynamic, or
 *   `'passive'` / `'auto'` under an interactive ancestor — and in every case no barrier above: no
 *   ancestor with `eventMode: 'none'` or `interactiveChildren: false`), mirroring 2D `hitArea`.
 * - Only the per-triangle volumes (`'geometry'` and `Geometry3D` instances) populate a hit's `normal` / `uv`;
 *   `Box`, `Sphere` and {@link IHitVolume3D} hits leave them zeroed.
 * - `'box'` and `'geometry'` on a `Mesh3D` are live: they track in-place geometry mutations and follow a
 *   geometry swap. On a plain `Container3D`, `'box'` is a snapshot of the subtree's bounds taken at set time;
 *   unlike `getLocalBounds()`, it includes hidden descendants.
 * - Per-triangle testing needs `'triangle-list'` topology; line, strip and point geometry never hits — use
 *   `'box'` or a triangle-list proxy for those.
 * - `'geometry'` warns and resolves to no shape on a plain `Container3D`, which has no geometry.
 * - A `Geometry3D` proxy needs `bounds3D` populated — the broadphase rejects against it.
 * @see {@link View3D#raycast} For querying a hit directly rather than through events
 * @category events
 * @standard
 */
export type HitVolume3DInput = 'box' | 'geometry' | Box | Sphere | Geometry3D | IHitVolume3D | null;

/**
 * Resolved hit volume stored on a `Container3D` after setter normalisation
 *
 * One of the engine's own shape types, or a user-supplied {@link IHitVolume3D}; strings and `null`
 * are gone by this point.
 * @internal
 * @see {@link HitVolume3DInput} The unresolved form users assign
 */
export type HitVolume3D = Box | Sphere | Geometry3D | IHitVolume3D;

/**
 * Scratch buffer written into during a ray vs. hit volume test
 *
 * Allocated once per `View3D` and reused across picks, so the hot path is allocation-free.
 *
 * `point` and `normal` are in the *node's local space* while the intersect call fills them; the pick loop converts
 * them to world space before surfacing them on a {@link RaycastHit3D} or an event's 3D fields.
 * @category events
 * @standard
 */
export interface HitResult3D {
  /** Hit point, local space until the pick loop converts it */
  point: Vector3;
  /** Flat geometric normal of the hit triangle, written only for `Geometry3D` hits */
  normal: Vector3;
  /** Interpolated UV at the hit, written only for `Geometry3D` hits when the geometry has UVs */
  uv: Vector2;
  /** Parametric `t` along the ray, in the ray's space (world units for rays from {@link View3D#screenToRay}) */
  distance: number;
  /**
   * Index of the triangle hit, `-1` for `Box` / `Sphere` volumes
   *
   * Doubles as the surface-data flag: `!== -1` is exactly the case where `normal` / `uv` describe a real triangle.
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
 * A ray-cast hit, in world space — what {@link View3D#raycast} returns, and what every 3D pointer
 * event carries as {@link Event3DFields#hit3D | hit3D}
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
 * - `raycast` returns a fresh object. An event's `hit3D` is pooled and rewritten per dispatch, the
 *   same contract as pixi's `event.global`: copy out anything you keep.
 * @see {@link Container3D#hitVolume} For choosing the shape each node is picked against
 * @category events
 * @standard
 */
export interface RaycastHit3D {
  /**
   * The event target the hit resolves to — the struck node, or its nearest
   * interactive ancestor when the struck node is non-interactive (`'auto'` /
   * `'passive'`; the surface fields still describe the struck node)
   */
  target: Container3D;
  /** World-space hit point */
  point: Vector3;
  /**
   * Hit point in the struck node's local space
   *
   * The struck node is usually `target`; for a hit on a non-interactive (`'auto'` / `'passive'`)
   * node it is that node, while `target` names its nearest interactive ancestor. The 3D counterpart
   * of 2D's `FederatedMouseEvent.getLocalPosition` for the struck node; for any other node, transform
   * `point` with {@link Container3D#toLocal}. There is no variant taking a node, because a 3D pointer
   * is a ray rather than a position and resolves to a point only where it hits.
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
   * Ray distance to the hit in world units — measured from the camera for
   * perspective projections and from the near-plane unproject for
   * orthographic ones
   */
  distance: number;
  /** World-space flat geometric normal of the hit triangle, zero when the volume is a `Box` / `Sphere` */
  normal: Vector3;
  /** UV at the hit when the volume is a `Geometry3D` with UVs, `(0, 0)` otherwise */
  uv: Vector2;
  /** Triangle index for `Geometry3D` hits; `-1` for `Box` / `Sphere` hits */
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
