import type { Cursor, IHitArea, PointData } from 'pixi.js';

import type { View3D } from '../scene/View3D';
import type { RaycastHit3D } from './HitResult3D';

/**
 * The pointer-event members of {@link View3D}
 *
 * Pixi's event system treats a View as one 2D object. These members connect it to the 3D scene:
 * when pixi hit-tests the View, a ray goes into the scene and picks a node, and the View then
 * passes the event on to that node. The work happens in the View's {@link EventBoundary3D},
 * `view3d.events`.
 * @example
 * ```ts
 * view3d.cursor = 'crosshair';                    // shown over empty space
 * view3d.hitArea = new Rectangle(0, 0, 400, 300); // only this part takes pointer events
 *
 * const hit = view3d.raycast({ x: 200, y: 150 }); // a pick without an event
 * ```
 * @see {@link EventBoundary3D} For the boundary these delegate to.
 * @category events
 * @standard
 */
export interface IView3DEvents {
  /**
   * Whether a point in the View's local 2D space is inside the View; pixi's hit test for the View
   *
   * Pixi calls it during its hit test, with the point already in the View's local space. It also
   * casts the ray into the scene and keeps the picked {@link Container3D} for the event that
   * follows. It answers `true` anywhere in the View's rectangle, so a click on empty space still
   * targets the View, and "click empty space to deselect" needs no extra wiring.
   * @remarks
   * - Because the whole rectangle counts, the View hides interactive 2D content behind it from
   *   pointer events: pixi's hit test stops at the topmost hit.
   * - To let events through, put the 2D UI above the View, set {@link View3D#hitArea} to keep only
   *   part of the View interactive, or set the View's own `eventMode` to `'none'`, which turns off
   *   3D picking too. `'passive'` only works while no 2D ancestor of the View is interactive;
   *   under one, pixi still hit-tests the View.
   * - Calling it from a listener changes the pick the rest of that event's dispatches use. Use
   *   {@link View3D#raycast} to query the scene.
   * @example
   * ```ts
   * const overView = view3d.containsPoint(view3d.toLocal({ x: 400, y: 300 }));
   * ```
   * @param {PointData} point - Point in View3D's local 2D space.
   * @returns Whether the point falls inside the View's 2D rect.
   */
  containsPoint(point: PointData): boolean;

  /**
   * CSS cursor shown over the View
   *
   * Over a 3D node, the View shows that node's {@link Container3D#cursor | cursor}. Over empty
   * space, or a node whose cursor is `null`, it shows the cursor set here. Pixi only reads the
   * cursor of the event's target, which stays the View, so the View passes the node's cursor on.
   * Reading it back returns the cursor in effect now, which can be the node's.
   * @example
   * ```ts
   * view3d.cursor = 'default'; // shown over empty space
   * mesh.cursor = 'pointer';   // shown while the ray hits the mesh
   * ```
   */
  cursor?: Cursor | (string & {});

  /**
   * Limits pointer events to a shape inside the View, in View-local 2D space, with 3D picking
   * still working inside it
   *
   * Pixi's hit test never calls `containsPoint` on a container with a `hitArea`, and that is where
   * the 3D pick runs. So the View keeps your shape and gives pixi a hit area of its own, which
   * tests your shape and then runs the pick.
   * @remarks
   * - The interactive region is where the shape and the View's rectangle overlap: a shape can
   *   shrink it but never extend it past the View. In 2D, `hitArea` replaces the bounds outright.
   * - Outside the shape the View isn't hit at all, so events reach the content behind it.
   * - Reading it back returns the View's own hit area, not your shape, so keep your own reference.
   * - {@link View3D#raycast} and {@link View3D#containsPoint} ignore the shape: they are direct
   *   queries, as a direct `containsPoint` call in 2D ignores `hitArea` too.
   * @example
   * ```ts
   * // Only the top-left 400×300 of the View is interactive;
   * // clicks outside it fall through to the 2D content behind.
   * view3d.hitArea = new Rectangle(0, 0, 400, 300);
   * ```
   */
  hitArea?: IHitArea | null;

  /**
   * Casts a ray through a 2D point and returns the closest hit
   *
   * `position` is in the space of `event.global` and pixi's `toGlobal`, as for
   * {@link View3D#screenToRay}. Use it to pick outside pointer events: placing decals, line of
   * sight, drag-and-drop targets.
   * @remarks
   * - Only nodes that take part in picking can be hit: interactive nodes and, under them, nodes
   *   with a shape (see {@link IFederatedContainer3D#eventMode}). In a scene where nothing is
   *   interactive it always returns `null`.
   * - Returns a new {@link RaycastHit3D} on every call. Events carry the same shape as `hit3D`.
   * - `distance` is measured from the camera, or from the camera plane for an orthographic camera,
   *   the same as `ray.at(t)` on {@link View3D#screenToRay}.
   * - It uses the transforms from the last render, so it picks what is on screen: a node or camera
   *   moved since then is picked where it was drawn.
   * - Hidden nodes, and nodes under a hidden ancestor, are skipped: they neither hit nor block
   *   what is behind them.
   * - A hit on a non-interactive (`'auto'` or `'passive'`) node reports its nearest interactive
   *   ancestor as `target`, while `point`, `normal`, `uv` and `triangleIndex` describe the node
   *   that was struck.
   * - A {@link Container3D#hitVolume | hitVolume} you set on an ancestor clips its descendants: a
   *   hit outside it is skipped and doesn't block what is behind it. Default volumes never clip.
   *   Pointer events follow the same rule.
   * - {@link View3D#hitArea} only limits pointer events, not this.
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
 * What `events/init.ts` mixes into `View3D.prototype`; {@link IView3DEvents} documents the members
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

  /**
   * Stores the shape the boundary's hit area tests
   *
   * Ignores the boundary's own hit area: `view.hitArea = view.hitArea` hands it back, and storing
   * it as the shape would make its `contains` call itself forever.
   * @param value - The shape, or `null` to clear it.
   */
  set hitArea(value: IHitArea | null | undefined) {
    if (value === this.events._hitAreaProxy) return;
    this.events._hitAreaShape = value ?? null;
  },

  raycast(position: PointData): RaycastHit3D | null {
    return this.events.raycast(position);
  },
};

declare global {
  namespace PixiMixins {
    interface View3D extends IView3DEvents {}
  }
}
