import type { Cursor, IHitArea, PointData } from 'pixi.js';

import type { View3D } from '../scene/View3D';
import type { RaycastHit3D } from './HitResult3D';

/**
 * The pointer-event members of {@link View3D}
 *
 * Pixi treats a View as one 2D object. When pixi hit-tests it, the View casts a ray into the scene
 * and passes the event on to the 3D node it hits.
 * @example
 * ```ts
 * view3d.cursor = 'crosshair';                    // shown over empty space
 * view3d.hitArea = new Rectangle(0, 0, 400, 300); // only this part takes pointer events
 *
 * const hit = view3d.raycast({ x: 200, y: 150 }); // a pick without an event
 * ```
 * @see {@link EventBoundary3D} For event settings that apply to the whole View, at `view3d.events`.
 * @category events
 * @standard
 */
export interface IView3DEvents {
  /**
   * Whether a point in the View's local 2D space is inside the View; pixi's hit test for the View
   *
   * It answers `true` anywhere in the View's rectangle, so a click on empty space still reaches the
   * View, and "click empty space to deselect" needs no extra wiring. It also picks the 3D node
   * under the point for the event that follows.
   * @remarks
   * - The View hides interactive 2D content behind it from pointer events. To let them through,
   *   put the 2D UI above the View, set {@link View3D#hitArea} to cover only part of it, or set the
   *   View's `eventMode` to `'none'` or `'passive'`, which turn off 3D pointer events too.
   *   `'passive'` lets 2D content through only while no 2D ancestor of the View is interactive.
   * - Calling it from a listener changes the pick the rest of that event uses. Use
   *   {@link View3D#raycast} to query the scene.
   * @example
   * ```ts
   * const overView = view3d.containsPoint(view3d.toLocal({ x: 400, y: 300 }));
   * ```
   * @param {PointData} point - Point in the View's local 2D space.
   */
  containsPoint(point: PointData): boolean;

  /**
   * CSS cursor shown over the View, except where the event's 3D target
   * ({@link Event3DFields#target3D | target3D}) sets its own {@link Container3D#cursor | cursor}
   *
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
   * @remarks
   * - The interactive region is where the shape and the View's rectangle overlap: a shape can
   *   shrink it but never extend it past the View, unlike 2D, where `hitArea` replaces the bounds.
   * - Outside the shape the View isn't hit at all, so events reach the content behind it.
   * - Reading it back returns another object, not your shape, so keep your own reference.
   * - {@link View3D#raycast} and {@link View3D#containsPoint} ignore the shape.
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
   * `position` is in the space of `event.global`, as for {@link View3D#screenToRay}. Use it to pick
   * outside pointer events: placing decals, line of sight, drag-and-drop targets.
   * @remarks
   * - Only nodes that take part in picking can be hit: interactive nodes and, under them, nodes
   *   with a shape (see {@link IFederatedContainer3D#eventMode}). In a scene where nothing is
   *   interactive it always returns `null`.
   * - Without `out` it allocates a new {@link RaycastHit3D} for each hit. Pass a hit from
   *   {@link createRaycastHit3D} as `out` to pick every frame without garbage.
   * - It uses the transforms and visibility from the last render, so a node or camera moved, shown
   *   or hidden since then is picked as it was drawn.
   * - Hidden nodes, and nodes under a hidden ancestor, neither hit nor block what is behind them.
   * - A {@link Container3D#hitVolume | hitVolume} you set on an ancestor clips its descendants'
   *   hits, as it does for pointer events.
   * @param {PointData} position - 2D global point to cast through (e.g. `event.global`).
   * @param {RaycastHit3D} [out] - Hit to write into, returned on a hit and untouched on a miss.
   * Defaults to a new one for each hit.
   * @returns The closest hit, or `null` on a miss or when the point falls outside the View's 2D rect.
   * @example
   * ```ts
   * // Drop a decal wherever the user taps.
   * view3d.on('pointertap', (e) => {
   *   const hit = view3d.raycast(e.global);
   *   if (hit) decal.position.copyFrom(hit.point); // world-space hit point
   * });
   *
   * // Follow the pointer every frame, reusing one hit.
   * const hover = createRaycastHit3D();
   * app.ticker.add(() => {
   *   if (view3d.raycast(pointer, hover)) cursor3d.position.copyFrom(hover.point);
   * });
   * ```
   * @see {@link View3D#screenToRay} For the ray on its own, without a scene pick.
   */
  raycast(position: PointData, out?: RaycastHit3D): RaycastHit3D | null;
}

/** @internal */
export const View3DEvents: IView3DEvents & ThisType<View3D> = {
  containsPoint(point: PointData): boolean {
    return this.events._containsPoint(point.x, point.y);
  },

  get cursor(): Cursor | (string & {}) | undefined {
    return this.events._cursor;
  },

  set cursor(value: Cursor | (string & {}) | undefined) {
    this.events._cursor = value;
  },

  get hitArea(): IHitArea | null {
    return this.events._hitAreaShape !== null ? this.events._hitAreaProxy : null;
  },

  /**
   * Ignores the boundary's own hit area, which the getter hands back; stored as the shape, its
   * `contains` would call itself forever
   */
  set hitArea(value: IHitArea | null | undefined) {
    if (value === this.events._hitAreaProxy) return;
    this.events._hitAreaShape = value ?? null;
  },

  raycast(position: PointData, out?: RaycastHit3D): RaycastHit3D | null {
    return this.events._raycast(position, out);
  },
};

declare global {
  namespace PixiMixins {
    interface View3D extends IView3DEvents {}
  }
}
