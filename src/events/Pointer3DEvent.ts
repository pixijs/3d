import type { FederatedPointerEvent, FederatedWheelEvent } from 'pixi.js';
import { FederatedMouseEvent } from 'pixi.js';

import type { Container3D } from '../scene/Container3D';
import type { RaycastHit3D } from './HitResult3D';
import { createRaycastHit3D } from './HitResult3D';

/**
 * The 3D fields a {@link View3D} adds to the pointer and wheel events it passes into its scene
 *
 * They sit on pixi's own event object, so 2D listeners that run after the View passes the event
 * on, such as the View's plain listeners and bubbling ones on its 2D ancestors, can read them too.
 * @remarks
 * - **Copy out anything you keep.** Pixi reuses event objects, so later events overwrite `hit3D`
 *   and its vectors, as they do `global`.
 * - The View's `on*` handlers and `*capture` listeners run before it passes the event on, so
 *   there the fields can be `null`. Read them in a plain listener, `view3d.on('pointertap', …)`.
 * - In a 3D node's listeners, except on `globalpointermove`, `globalmousemove` and
 *   `globaltouchmove`, `composedPath()` returns the 3D chain, `[view3d.root, …, target]`, in an
 *   array the View can empty after the event. Copy it to keep it.
 * - On events that never passed through a View3D, the fields read `null`. The exception is a 2D
 *   node's `pointerover` and `mouseover` when the pointer moves straight off the View onto it:
 *   `target3D` still names the 3D node it left.
 * @example
 * ```ts
 * mesh.hitVolume = 'geometry'; // per-triangle hits, so `normal` isn't zero
 * mesh.on('pointertap', (e) => {
 *   if (!e.hit3D) return;
 *   spawnDecal(e.hit3D.point, e.hit3D.normal); // reading inside the handler is fine
 *   lastHit.copyFrom(e.hit3D.point);           // keeping the value needs a copy
 * });
 * ```
 * @category events
 * @standard
 */
export interface Event3DFields {
  /**
   * What the pointer is over: the hit {@link View3D#raycast} would return for `event.global`, or
   * `null` when the ray hits nothing
   *
   * It ignores which node is being told, so a `pointerupoutside` on the pressed node reports where
   * the pointer was released, such as on a drop target, and a `pointerout` reports the node the
   * pointer moved onto. It is `null` on the `pointerout` as the pointer leaves the View and on a
   * release outside the View.
   * @example
   * ```ts
   * ground.on('pointertap', (e) => {
   *   if (e.hit3D) marker.position.copyFrom(e.hit3D.point); // drop a marker where the ray landed
   * });
   *
   * // Only per-triangle volumes carry surface data
   * wall.hitVolume = 'geometry';
   * wall.on('pointertap', (e) => {
   *   if (e.hit3D && e.hit3D.normal.y > 0.9) console.log('floor, not wall');
   * });
   * ```
   */
  readonly hit3D: RaycastHit3D | null;
  /**
   * The 3D node this event is about, or `null` when it belongs to the View, as on a click on empty
   * space
   *
   * The View's own listeners see the View as `event.target`, while `target3D` still names the node.
   * @remarks
   * - In a 3D node's `*upoutside` listeners it names the pressed node.
   * - During `pointerenter` and `pointerleave`, which don't bubble, it names the node being told.
   * - When the ray strikes a non-interactive (`'auto'` or `'passive'`) node, it names that node's
   *   nearest interactive ancestor.
   * @example
   * ```ts
   * // One View-level listener instead of a listener per mesh
   * view3d.on('pointertap', (e) => {
   *   if (e.target3D) select(e.target3D);
   *   else clearSelection();
   * });
   * ```
   */
  readonly target3D: Container3D | null;
  /**
   * The 3D node whose listeners are running, or `null` outside the 3D dispatch
   *
   * The 3D counterpart of `currentTarget`: while `target3D` stays on the event's target, this moves
   * from node to node, so an ancestor's listener reads the ancestor. The View's own listeners read
   * `null`.
   * @example
   * ```ts
   * // One listener on the group tells which node it fired on
   * group.on('pointerdown', (e) => {
   *   // e.target3D is the node hit, or the group when that node isn't interactive
   *   console.log(e.currentTarget3D === group); // true
   * });
   * ```
   */
  readonly currentTarget3D: Container3D | null;
}

/**
 * The type of a pointer handler property on a 3D node, such as
 * {@link IFederatedContainer3D#onclick | onclick}
 * @example
 * ```ts
 * const grow: Pointer3DEventHandler = (e) => e.target3D?.scale.set(1.1);
 *
 * button.onpointerenter = grow;
 * ```
 * @category events
 * @standard
 */
export type Pointer3DEventHandler = (event: Pointer3DEvent) => void;

/**
 * The type of {@link IFederatedContainer3D#onwheel | Container3D.onwheel}
 * @example
 * ```ts
 * const push: Wheel3DEventHandler = (e) => {
 *   panel.position.z += e.deltaY * 0.01;
 * };
 *
 * panel.onwheel = push;
 * ```
 * @category events
 * @standard
 */
export type Wheel3DEventHandler = (event: Wheel3DEvent) => void;

/**
 * A pixi.js `FederatedPointerEvent` with the {@link Event3DFields | 3D fields}; what a 3D node's
 * pointer, mouse and touch listeners receive
 * @example
 * ```ts
 * function onGrab(e: Pointer3DEvent): void {
 *   if (e.hit3D) grabPoint.copyFrom(e.hit3D.point);
 * }
 *
 * handle.on('pointerdown', onGrab);
 * ```
 * @category events
 * @standard
 */
export interface Pointer3DEvent extends FederatedPointerEvent, Event3DFields {}

/**
 * A pixi.js `FederatedWheelEvent` with the {@link Event3DFields | 3D fields}
 * @example
 * ```ts
 * function onZoom(e: Wheel3DEvent): void {
 *   if (e.hit3D) zoomToward(e.hit3D.point, e.deltaY);
 * }
 *
 * view3d.on('wheel', onZoom);
 * ```
 * @category events
 * @standard
 */
export interface Wheel3DEvent extends FederatedWheelEvent, Event3DFields {}

/**
 * A token no `nativeEvent` equals, not even a synthetic event's `undefined`
 * @internal
 */
export const TOKEN_NONE: unknown = {};

interface Pick3DStorage {
  /**
   * The `nativeEvent` that `_writeFields` in `EventBoundary3D.ts` wrote the fields for; pixi reuses
   * event objects, so the getters read `null` once the event's `nativeEvent` differs
   */
  token: unknown;
  hit: RaycastHit3D;
  hasHit: boolean;
  target: Container3D | null;
  currentTarget: Container3D | null;
}

/**
 * On first use, defines the getters on the event itself, for an event whose prototype lacks them,
 * such as one from a second copy of pixi.js
 * @internal
 */
export function ensurePick3D(event: FederatedMouseEvent): Pick3DStorage {
  const e = event as FederatedMouseEvent & { _pick3D?: Pick3DStorage };
  let storage = e._pick3D;
  if (storage === undefined) {
    storage = e._pick3D = {
      token: TOKEN_NONE,
      hit: createRaycastHit3D(),
      hasHit: false,
      target: null,
      currentTarget: null,
    };
    Object.defineProperties(e, PICK3D_ACCESSORS);
  }
  return storage;
}

/**
 * `configurable`, so evaluating this module twice (two copies of the package, or a dev-server
 * reload) redefines the getters instead of throwing
 */
const PICK3D_ACCESSORS: PropertyDescriptorMap = {
  hit3D: {
    configurable: true,
    get(this: FederatedMouseEvent): RaycastHit3D | null {
      const s = ensurePick3D(this);
      return s.token === this.nativeEvent && s.hasHit ? s.hit : null;
    },
  },
  target3D: {
    configurable: true,
    get(this: FederatedMouseEvent): Container3D | null {
      const s = ensurePick3D(this);
      return s.token === this.nativeEvent ? s.target : null;
    },
  },
  currentTarget3D: {
    configurable: true,
    get(this: FederatedMouseEvent): Container3D | null {
      const s = ensurePick3D(this);
      return s.token === this.nativeEvent ? s.currentTarget : null;
    },
  },
};

Object.defineProperties(FederatedMouseEvent.prototype, PICK3D_ACCESSORS);

/**
 * Lets the View's own listeners read `target3D` without a cast; true at runtime, since
 * `PICK3D_ACCESSORS` sit on `FederatedMouseEvent.prototype`
 */
declare module 'pixi.js' {
  interface FederatedMouseEvent extends Event3DFields {}
}
