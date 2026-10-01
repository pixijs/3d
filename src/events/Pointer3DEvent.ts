import type { FederatedPointerEvent, FederatedWheelEvent } from 'pixi.js';
import { FederatedMouseEvent } from 'pixi.js';

import type { Container3D } from '../scene/Container3D';
import type { RaycastHit3D } from './HitResult3D';
import { createRaycastHit3D } from './HitResult3D';

/**
 * The 3D fields a {@link View3D} adds to the pointer and wheel events it passes into its scene
 *
 * The View adds them to pixi's event object rather than wrapping it, so a 2D listener higher up,
 * on the View or a 2D ancestor, gets the same object and can read
 * {@link Event3DFields#target3D | target3D} to find the 3D node that was picked.
 * @remarks
 * - **Copy out anything you keep.** `hit3D` and its vectors belong to the event object, which
 *   pixi reuses for later events, as it does `global` and `screen`.
 * - While a 3D node's listeners run, `composedPath()` returns the 3D chain being dispatched,
 *   `[root3D, …, target]`. The array is reused too: copy it to keep it.
 * - Outside a dispatch that went through a View3D, all three fields read `null`, including on a
 *   reused event object that carried a hit earlier.
 * - On the View itself, only plain listeners (`view3d.on('pointertap', …)`) see the fields. Pixi
 *   calls the View's `on*` handler and its `*capture` listeners before the 3D dispatch runs, so
 *   `view3d.onpointertap` and `view3d.on('pointertapcapture', …)` read `null`.
 * @example
 * ```ts
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
   * It doesn't depend on which node the event is about: `target3D` says who is being told,
   * `hit3D` says what is under the pointer. So a `pointerupoutside` on the pressed node reports
   * the node the pointer was released over, such as a drop target, and a `pointerout` reports the
   * node the pointer moved onto. It is `null` on events pixi delivers without hit-testing this
   * View: the `pointerout` when the pointer leaves the View, and a release outside the View.
   *
   * On a hit against a non-interactive (`'auto'` or `'passive'`) node, `hit3D.target` is its
   * nearest interactive ancestor, while the surface fields describe the node that was struck.
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
   * The 3D node this event is about, or `null` when it belongs to the View itself
   *
   * `null` includes a click on empty space. A 3D node's listeners see the same node as
   * `event.target`. The View's own listeners see the View as `event.target`, while `target3D`
   * still names the node.
   * @remarks
   * - On `*upoutside` events it names the pressed node; `hit3D` says what the release landed on,
   *   if anything.
   * - During `pointerenter` and `pointerleave`, which don't bubble, it names the node being told.
   * - On a hit against a non-interactive (`'auto'` or `'passive'`) node, it names that node's
   *   nearest interactive ancestor, the same node as `hit3D.target`.
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
   * The 3D counterpart of `currentTarget`: `target3D` stays on the event's target, while this
   * moves from node to node through the capture, target and bubble phases, so an ancestor's
   * listener reads the ancestor here. During `pointerenter`, `pointerleave`, the
   * `pointerupoutside` walk and `globalpointermove`, it names the node being told. The View's own
   * listeners run after the 3D dispatch has finished, so for them it reads `null` while
   * `target3D` still names the picked node.
   * @example
   * ```ts
   * // One listener on the group tells which node it fired on
   * group.on('pointerdown', (e) => {
   *   console.log(e.currentTarget3D === group); // true; e.target3D is the picked descendant
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
 * A pixi.js `FederatedPointerEvent` with the {@link Event3DFields | 3D fields}
 *
 * The type of every pointer event a 3D node's listeners receive. The View's own listeners get the
 * same event object, whether the pointer is over a node or over empty space.
 * @example
 * ```ts
 * function onGrab(e: Pointer3DEvent): void {
 *   if (e.hit3D) grabPoint.copyFrom(e.hit3D.point);
 * }
 *
 * handle.on('pointerdown', onGrab);
 * ```
 * @see {@link Event3DFields} For the 3D fields and how long they stay valid.
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
 * @see {@link Event3DFields} For the 3D fields and how long they stay valid.
 * @category events
 * @standard
 */
export interface Wheel3DEvent extends FederatedWheelEvent, Event3DFields {}

/**
 * Token for 3D fields that were never written
 *
 * A fresh object, so no `nativeEvent` equals it, not even the `undefined` of a synthetic event.
 * @internal
 */
export const TOKEN_NONE: unknown = {};

/**
 * Where an event's 3D fields are stored
 *
 * Pixi reuses event objects, so the stored fields outlive their dispatch. `token` is the
 * `nativeEvent` they were written for, and the `PICK3D_ACCESSORS` getters answer `null` once the
 * event's `nativeEvent` no longer matches.
 * @internal
 */
interface Pick3DStorage {
  token: unknown;
  /** Reported as `hit3D` while `hasHit`; rewritten in place for each dispatch */
  hit: RaycastHit3D;
  /** Whether `hit` belongs to the current dispatch; `false` on a miss, so `hit3D` reads `null` */
  hasHit: boolean;
  target: Container3D | null;
  currentTarget: Container3D | null;
}

/**
 * Returns the event's 3D field storage, creating it the first time the event is seen
 *
 * The write helpers call it on every dispatch, and the getters call it too, so an event that
 * never went through a View3D still reads a consistent `null`. The first call also defines the
 * getters on the event itself, which only matters for an event whose prototype lacks them, such as
 * one made by a second copy of pixi.js.
 * @param event - the federated event to read or create 3D storage on.
 * @returns The event's 3D-field storage.
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
 * The getters behind {@link Event3DFields}
 *
 * Each one checks the storage token against the event's `nativeEvent`. A mismatch means the event
 * object is on a dispatch that never went through a View3D, so the field reads `null` instead of
 * a previous hit.
 *
 * They are installed on `FederatedMouseEvent.prototype`, which pointer and wheel events both
 * extend, so the fields read `null` rather than `undefined` on events no View3D has touched. Every
 * descriptor is `configurable`, so evaluating this module twice (two copies of the package against
 * one pixi.js, or a dev-server reload) redefines them instead of throwing.
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
 * Types every pixi.js mouse, pointer and wheel event with {@link Event3DFields}
 *
 * True at runtime: the getters on `FederatedMouseEvent.prototype` answer on every such event,
 * with `null` when no 3D pick is current. It lets the View's own listeners
 * (`view3d.on('pointermove', …)`) read `target3D` without a cast.
 */
declare module 'pixi.js' {
  interface FederatedMouseEvent extends Event3DFields {}
}
