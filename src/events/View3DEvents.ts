import type { Cursor, IHitArea, PointData } from 'pixi.js';

import type { View3D } from '../scene/View3D';
import type { RaycastHit3D } from './HitResult3D';

/**
 * The interaction members mixed into {@link View3D}
 *
 * Thin delegates into the View's {@link EventBoundary3D} (`view3d.events`), which owns all state and
 * dispatch logic. Applied to `View3D.prototype` with `extensions.mixin`, mirroring how pixi.js mixes
 * `FederatedContainer` into `Container`.
 * @see {@link EventBoundary3D} For the boundary these delegate to.
 * @category events
 * @standard
 */
export interface IView3DEvents {
  /**
   * Hit-tests a 2D point against the View — the hook that wires 3D picking into pixi's `EventBoundary`
   *
   * Pixi calls it for every pointer event after `worldTransform.applyInverse(globalPoint, localPoint)`,
   * so `point` is in View3D's local 2D space. It runs the 3D ray cast, caches the picked
   * {@link Container3D} for the dispatch that follows, and reports containment anywhere inside the
   * View's 2D bounds: a viewport miss still resolves to View3D itself as the event target, so "click
   * empty space to deselect" needs no extra wiring.
   * @remarks
   * - Because the whole rect reports containment, the View occludes interactive 2D content layered
   *   *behind* it — 2D hit-testing stops at the topmost hit.
   * - To let events fall through, put 2D UI above the View in the display list, set the View's own
   *   2D `eventMode` to `'none'` / `'passive'` (which also disables 3D interaction with it), or set
   *   {@link View3D#hitArea} to keep only part of the viewport interactive.
   * @param {PointData} point - Point in View3D's local 2D space.
   * @returns Whether the point falls inside the View's 2D rect.
   */
  containsPoint(point: PointData): boolean;

  /**
   * CSS cursor shown over this View, forwarding the picked 3D node's own cursor
   *
   * Pixi reads `e.target.cursor` to update the canvas CSS cursor and `e.target` stays the View3D
   * through 2D dispatch, so the picked node's cursor has to flow through here: reads resolve the
   * current pick's cursor and fall back to the View's own, writes set that fallback. A 3D node whose
   * {@link Container3D#cursor} is `null` therefore shows the View's cursor, where bare 2D would coerce
   * to `'default'`.
   * @example
   * ```ts
   * view3d.cursor = 'default';  // shown over empty viewport
   * mesh.cursor = 'pointer';    // shown while the ray hits the mesh
   * ```
   */
  cursor?: Cursor | (string & {});

  /**
   * Restricts the View's interactive region to a shape, in View-local 2D space, with 3D picking
   * still working inside it
   *
   * Pixi's hit test short-circuits on a container with a `hitArea` and never calls `containsPoint`,
   * which is where the 3D pick runs — so the View intercepts this property and hands pixi a composite
   * that tests the shape first, then runs the pick.
   * @remarks
   * - The interactive region is the intersection of the shape and the View's 2D rect: a shape can
   *   shrink the region, never extend it past the viewport. This diverges from 2D on purpose, where
   *   `hitArea` replaces the container's bounds outright.
   * - Outside the shape the View is not hit at all, so events fall through to content behind it —
   *   the third fall-through lever listed on {@link View3D#containsPoint}.
   * - Reading it back returns the View's composite hit area, not the shape you assigned — keep your
   *   own reference. The same read/write asymmetry {@link View3D#cursor} has.
   * - {@link View3D#raycast} and {@link View3D#containsPoint} ignore the shape: both are explicit
   *   geometric queries, matching 2D, where a direct `containsPoint` call bypasses `hitArea` too.
   * @example
   * ```ts
   * // Only the top-left 400×300 of the View is interactive;
   * // clicks outside it fall through to the 2D content behind.
   * view3d.hitArea = new Rectangle(0, 0, 400, 300);
   * ```
   */
  hitArea?: IHitArea | null;

  /**
   * Ray-casts at a 2D global point and returns the closest hit
   *
   * `position` is in the space of `event.global` and pixi's `toGlobal`, shared with
   * {@link View3D#screenToRay}. Use this for picking outside the pointer pipeline: placing decals, AI
   * line-of-sight, drag-and-drop hit tests.
   * @remarks
   * - Returns a fresh {@link RaycastHit3D}; events carry the same shape, pooled, as `hit3D`.
   * - `distance` is measured from the camera (from the camera plane for orthographic projections),
   *   matching `ray.at(t)` on {@link View3D#screenToRay} and `hit3D.distance` on events.
   * - Picks see the scene as of the last render/transform pass, since the ray is built from cached
   *   camera / View transforms and tested against node `worldTransform`s. A pick issued before the
   *   first render, or after mutating transforms in the same tick, reads last-frame values and so
   *   stays consistent with what is on screen.
   * - Hidden nodes (`visible === false` on the node or any ancestor) are skipped: they neither pick
   *   nor occlude nodes behind them.
   * - A hit on a non-interactive (`'auto'` / `'passive'`) node reports its nearest interactive
   *   ancestor as `target` while the surface data (`point` / `normal` / `uv` / `triangleIndex`)
   *   comes from the struck node.
   * - An ancestor's explicit {@link Container3D#hitVolume | hitVolume} clips its descendants: a hit
   *   whose point falls outside any explicit ancestor volume is skipped without occluding what's
   *   behind it. Default volumes never clip — the same rule event picking uses.
   * - {@link View3D#hitArea} does not clip raycast queries; the shape only restricts pointer events.
   * @param {PointData} position - 2D global point to cast through (e.g. `event.global`).
   * @returns The closest hit, or `null` on a miss or when the point falls outside the View's 2D rect.
   * @example
   * ```ts
   * // Drop a decal wherever the user taps.
   * view3d.on('pointertap', (e) => {
   *   const hit = view3d.raycast(e.global);
   *   if (hit) decal.position.copyFrom(hit.point); // world-space hit point
   * });
   * ```
   * @see {@link View3D#screenToRay} For the ray on its own, without a scene pick.
   * @see {@link RaycastHit3D} For the shape of the returned hit.
   */
  raycast(position: PointData): RaycastHit3D | null;
}

/**
 * The mixin applied to `View3D.prototype` by `events/init.ts` — see {@link IView3DEvents}
 * @internal
 */
export const View3DEvents: IView3DEvents & ThisType<View3D> = {
  containsPoint(point: PointData): boolean {
    return this.events._containsPoint(point.x, point.y);
  },

  get cursor(): Cursor | (string & {}) | undefined {
    return this.events.cursor;
  },

  set cursor(value: Cursor | (string & {}) | undefined) {
    this.events.cursor = value;
  },

  get hitArea(): IHitArea | null {
    return this.events._hitAreaShape !== null ? this.events._hitAreaProxy : null;
  },

  set hitArea(value: IHitArea | null | undefined) {
    // `view.hitArea = view.hitArea` hands the proxy back; storing it as the shape would make
    // `contains` recurse into itself forever.
    if (value === this.events._hitAreaProxy) return;
    this.events._hitAreaShape = value ?? null;
  },

  raycast(position: PointData): RaycastHit3D | null {
    return this.events.raycast(position);
  },
};

declare global {
  namespace PixiMixins {
    // oxlint-disable-next-line no-empty-object-type
    interface View3D extends IView3DEvents {}
  }
}
