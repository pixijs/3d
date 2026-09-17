import type { FederatedPointerEvent, FederatedWheelEvent } from 'pixi.js';
import { FederatedMouseEvent } from 'pixi.js';

import type { Container3D } from '../scene/Container3D';
import type { RaycastHit3D } from './HitResult3D';
import { createRaycastHit3D } from './HitResult3D';

/**
 * The 3D fields {@link View3D} installs on the federated events it re-dispatches
 *
 * The event is augmented in place rather than wrapped, so a 2D listener higher up the chain — on the
 * View3D or a 2D ancestor — sees the same object and can branch on {@link Event3DFields#target3D} to
 * recover the picked 3D node without an `instanceof` check.
 * @remarks
 * - **Copy out anything you keep.** `hit3D` and the vectors inside it are owned by the event object
 *   and reused across dispatches, the same contract as pixi's `global` / `screen`.
 * - During a 3D chain dispatch `composedPath()` returns the frozen 3D propagation chain
 *   `[root3D, …, target]` the dispatch walks. The array is pooled — valid only during the dispatch,
 *   copy to retain.
 * - Reads are only meaningful while the event is on a dispatch that ran through a View3D. The fields
 *   are token-guarded accessors on the federated event prototypes: every write stamps the event's
 *   current `nativeEvent`, and a read whose stamp doesn't match — the pooled event object was recycled
 *   for an unrelated dispatch, or no dispatch ever crossed a View3D — answers as a miss (all three
 *   fields `null`) rather than leaking a previous hit or reading `undefined`.
 * - On the View itself, only plain listeners (`view3d.on('pointertap', …)`) run after the 3D dispatch
 *   has written the fields. Pixi notifies the View's `on*` handler and its `*capture` listeners
 *   first, so `view3d.onpointertap` and `view3d.on('pointertapcapture', …)` read a miss.
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
   * The ray-cast at this event's pointer position — what {@link View3D#raycast} returns for
   * `event.global` — or `null` when the ray struck nothing or the event carries no ray
   *
   * Independent of which node the dispatch is about: `target3D` says who is being told, `hit3D`
   * says what is under the pointer. A `pointerupoutside` on the pressed node still reports the node
   * the pointer released over (a drop target), and a `pointerout` reports the node the pointer moved
   * onto. It is `null` on the events pixi delivers without hit-testing this View: the View-exit
   * `pointerout`, and releases resolved outside the View (an `*upoutside` arriving from another 2D
   * element or from off-canvas).
   *
   * On a hit against a non-interactive (`'auto'` / `'passive'`) node, `hit3D.target` is the nearest
   * interactive ancestor while the surface fields describe the struck node.
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
   * The 3D node this dispatch is about, or `null` when the event belongs to the View itself
   *
   * `null` covers the viewport miss — a click on empty space. Inside the 3D chain the field matches
   * `event.target`; for View-level (2D) listeners `event.target` has been restored to the View3D
   * while `target3D` still names the node.
   * @remarks
   * - On `*upoutside` events it names the press target; `hit3D` still says what the release landed
   *   on, if anything.
   * - During the non-bubbling `pointerenter` / `pointerleave` walks it names the node being notified.
   * - On a hit against a non-interactive (`'auto'` / `'passive'`) node it names that node's nearest
   *   interactive ancestor, the same node as `hit3D.target`.
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
   * The 3D node whose listeners are currently being notified, or `null` outside a 3D chain dispatch
   *
   * The 3D counterpart of `currentTarget`: while {@link Event3DFields#target3D} stays fixed on the
   * dispatch target, this varies per hop as the dispatch walks capture / at-target / bubble — an
   * ancestor's listener reads the ancestor here. During the non-bubbling `pointerenter` /
   * `pointerleave` walks, the `pointerupoutside` reconciliation walk and the `globalpointermove`
   * fan-out it names the node being notified. For View-level (2D) listeners the 3D chain has already
   * unwound, so it reads `null` while `target3D` still names the picked node.
   * @example
   * ```ts
   * // One listener on the group tells which hop it fired on
   * group.on('pointerdown', (e) => {
   *   console.log(e.currentTarget3D === group); // true — vs. e.target3D, the picked descendant
   * });
   * ```
   */
  readonly currentTarget3D: Container3D | null;
}

/**
 * Callback shape of the pointer on-handler properties ({@link IFederatedContainer3D#onclick | onclick}, …)
 * @category events
 * @standard
 */
export type Pointer3DEventHandler = (event: Pointer3DEvent) => void;

/**
 * Callback shape of {@link IFederatedContainer3D#onwheel | Container3D.onwheel}
 * @category events
 * @standard
 */
export type Wheel3DEventHandler = (event: Wheel3DEvent) => void;

/**
 * A `FederatedPointerEvent` carrying the {@link Event3DFields | 3D hit fields}
 *
 * Dispatched by {@link View3D}'s interaction layer against the picked {@link Container3D}, and against
 * the View3D itself on a viewport miss.
 * @see {@link Event3DFields} For the 3D fields and their lifetime contract.
 * @category events
 * @standard
 */
export interface Pointer3DEvent extends FederatedPointerEvent, Event3DFields {}

/**
 * A `FederatedWheelEvent` carrying the {@link Event3DFields | 3D hit fields}
 * @see {@link Event3DFields} For the 3D fields and their lifetime contract.
 * @category events
 * @standard
 */
export interface Wheel3DEvent extends FederatedWheelEvent, Event3DFields {}

/**
 * Guard token marking 3D event fields that have never been written (or were reset). A unique
 * object so no `nativeEvent` — not even `undefined` on a synthetic test event — compares equal to it.
 * @internal
 */
export const TOKEN_NONE: unknown = {};

/**
 * Backing store for the 3D fields carried by a pooled federated event. `token` is the
 * `nativeEvent` the fields were last written for: pixi pools and reuses event objects, so a field-set
 * outlives its dispatch. Reads go through `PICK3D_ACCESSORS`, which compares the token against the
 * event's current `nativeEvent` and answers as a miss once the event has moved on to an unrelated
 * dispatch.
 * @internal
 */
interface Pick3DStorage {
  token: unknown;
  /** The pooled hit surfaced as `hit3D` while `hasHit`; rewritten in place per dispatch */
  hit: RaycastHit3D;
  /** Whether `hit` describes the current dispatch — `false` on a miss, so `hit3D` reads `null` */
  hasHit: boolean;
  target: Container3D | null;
  currentTarget: Container3D | null;
}

/**
 * Returns the event's 3D-field backing storage, creating it — plus own accessor properties,
 * for event objects whose prototype chain lacks the federated-event install below — the first time the
 * event is seen. The write helpers call this on every dispatch; the prototype accessors call it lazily,
 * so even an event that never crossed a View3D answers a coherent miss on first read.
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
 * The 3D-field accessor set
 *
 * See {@link Event3DFields} for what each field means. Every getter validates the storage token: a
 * mismatch means the event is on a dispatch that never crossed a View3D — the pooled object was
 * recycled, or no 3D dispatch ever touched it — so the fields answer as a miss (all `null`) instead
 * of leaking a previous hit.
 *
 * Every descriptor is `configurable`, so a second evaluation of this module — two copies of the
 * package against one `pixi.js`, or a dev-server re-import — redefines the prototype accessors
 * instead of throwing.
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

// Installed on the shared mouse-event prototype — pointer and wheel events both extend it — so the 3D
// fields answer the documented miss even on events that never crossed a View3D, where `e.target3D`
// would otherwise read `undefined`. Events that do cross a View additionally get own-property
// accessors backed by their own storage via `ensurePick3D`.
Object.defineProperties(FederatedMouseEvent.prototype, PICK3D_ACCESSORS);

/**
 * Type-level mirror of the prototype install above: every federated mouse / wheel event genuinely
 * answers the {@link Event3DFields} at runtime — with miss values when no 3D pick is current — so the
 * augmentation states a runtime truth rather than a convenience lie. It's what lets View-level
 * listeners (`view3d.on('pointermove', …)`) read `target3D` and friends without narrowing.
 */
declare module 'pixi.js' {
  // oxlint-disable-next-line no-empty-object-type
  interface FederatedMouseEvent extends Event3DFields {}
}
