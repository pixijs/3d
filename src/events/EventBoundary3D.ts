import { EventSystem, GlobalResourceRegistry, warn } from 'pixi.js';
import type {
  Cursor,
  EventEmitter,
  FederatedMouseEvent,
  FederatedPointerEvent,
  FederatedWheelEvent,
  IHitArea,
  PointData,
} from 'pixi.js';

import { Geometry3D } from '../geometry/Geometry3D';
import { Matrix4 } from '../math/matrix/Matrix4';
import { Box } from '../math/shapes/Box';
import { Ray } from '../math/shapes/Ray';
import { Sphere } from '../math/shapes/Sphere';
import { Vector2 } from '../math/vector/Vector2';
import { Vector3 } from '../math/vector/Vector3';
import type { Container3D } from '../scene/Container3D';
import type { View3D } from '../scene/View3D';
import type { HitResult3D, RaycastHit3D } from './HitResult3D';
import { copyRaycastHit3D, createHitResult3D, createRaycastHit3D } from './HitResult3D';
import { hitVolumeBoundingRadiusSq, intersectRayHitVolume } from './intersectRayHitVolume';
import { ensurePick3D, TOKEN_NONE } from './Pointer3DEvent';

/**
 * Pointer event types the View3D re-dispatches into the 3D scene
 *
 * Listed explicitly so the hot path never string-prefix-matches. Each type gets its own listener
 * closure: pixi's alias dispatches (`mousedown`, `touchstart`, `rightup`, …) reuse one pooled event
 * object whose `type` still reads the primary name, so the emitter key, not `event.type`, names the
 * dispatch.
 *
 * `pointerout` and `pointerover` are not forwarded to a picked node; they are the "pointer left /
 * entered the View" signals. `pointerout` flushes that pointer's 3D hover state, `pointerover` seeds
 * it on entry so hover events don't wait for the first `pointermove`. The hover family on 3D nodes is
 * synthesized from those two plus the move-driven diff, so the incoming 2D `mouseover` / `mouseout`
 * dispatches carry nothing new and are not registered.
 *
 * `pointercancel` is deliberately absent, matching pixi 2D, whose event system never maps it: a
 * cancelled pointer is an abandoned press, and its record is reclaimed per
 * `POINTER_RECORD_STALE_MS`.
 *
 * `wheel` and `globalpointermove` have their own listeners — `wheel` carries a `FederatedWheelEvent`,
 * and global moves fan out instead of walking a chain.
 */
const POINTER_EVENT_TYPES = [
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointerupoutside',
  'pointerout',
  'pointerover',
  'pointertap',
  'click',
  'tap',
  'rightclick',
  'mousedown',
  'mouseup',
  'mousemove',
  'mouseupoutside',
  'rightdown',
  'rightup',
  'rightupoutside',
  'touchstart',
  'touchmove',
  'touchend',
  'touchendoutside',
] as const;

/** Event types forwarded into the 3D scene — the members of `POINTER_EVENT_TYPES` */
type Forwarded3DPointerType = (typeof POINTER_EVENT_TYPES)[number];

/**
 * Multi-click window, in milliseconds
 *
 * Same-target clicks inside it increment `detail` — 2D parity, and like 2D there is no positional
 * threshold.
 */
const MULTI_CLICK_INTERVAL_MS = 200;

/**
 * Idle bound for per-pointer records, in milliseconds
 *
 * A record that has seen no events for this long is reclaimed when a new pointer appears: browsers
 * that mint a fresh `pointerId` per touch (iOS Safari, Chrome Android) never reuse an id, and pixi
 * never delivers `pointercancel`, so a cancelled touch's record would otherwise pin its press-path
 * nodes forever. Generous, because a held-still press legitimately produces no events and must
 * survive other fingers tapping around it.
 */
const POINTER_RECORD_STALE_MS = 60_000;

/**
 * Event types the chain walk dispatches under
 *
 * Every forwarded type except the `*upoutside` family, whose walk hard-codes its keys, plus the
 * synthesized hover pair and `wheel`.
 */
type Chained3DType = Exclude<Forwarded3DPointerType, `${string}outside`> | 'mouseover' | 'mouseout' | 'wheel';

/**
 * Per-type emitter / on-handler keys used by the chain walk
 *
 * Precomputed for every `Chained3DType` so steady pointer traffic never concatenates strings.
 */
const CHAIN_KEYS: Record<Chained3DType, { onKey: string; captureKey: string }> = Object.create(null);
for (const type of [...POINTER_EVENT_TYPES, 'mouseover', 'mouseout', 'wheel'] as const) {
  if (type.endsWith('outside')) continue;
  CHAIN_KEYS[type as Chained3DType] = { onKey: 'on' + type, captureKey: type + 'capture' };
}

/**
 * The `eventemitter3` internal listener record
 *
 * The dispatcher reads `_events` directly, as 2D's `EventBoundary._notifyListeners` does, because
 * `emit` runs a node's whole listener array unconditionally and so cannot honor
 * `stopImmediatePropagation` between a node's own listeners.
 */
interface EmitterListener {
  fn: (event: FederatedMouseEvent) => void;
  context: unknown;
  once: boolean;
}

interface EmitterInternal {
  _events: Record<string, EmitterListener | EmitterListener[] | undefined>;
}

/** A federated event with its readonly `type` made writable, so the 3D walks can rewrite and restore it */
type WritableTypeEvent = FederatedMouseEvent & { type: string };

/**
 * Invokes `node`'s listeners for `key` — the 2D-parity port of `EventBoundary._notifyListeners`
 *
 * `once` listeners are removed before being called and, on the array path only, the loop stops as
 * soon as `propagationImmediatelyStopped` is set. The single-listener fast path skips that flag
 * check, replicating the 2D quirk where a lone listener still fires after a same-node immediate stop.
 * @param node - Node whose listeners are notified.
 * @param key - Emitter key to fire (`'pointerdown'`, `'pointerdowncapture'`, an alias type, …).
 * @param event - The live federated event, already carrying its 3D fields.
 */
function notifyListeners3D(node: Container3D, key: string, event: FederatedMouseEvent): void {
  // Dispatch-time string keys are not in the typed `Container3DEvents` surface, so it is bypassed
  // here, as 2D's `_notifyListeners` does.
  const emitter = node as unknown as EventEmitter;
  const listeners = (node as unknown as EmitterInternal)._events[key];
  if (!listeners) return;
  if ('fn' in listeners) {
    if (listeners.once) emitter.removeListener(key, listeners.fn, undefined, true);
    listeners.fn.call(listeners.context, event);
  } else {
    for (let i = 0, j = listeners.length; i < j && !event.propagationImmediatelyStopped; i++) {
      if (listeners[i].once) emitter.removeListener(key, listeners[i].fn, undefined, true);
      listeners[i].fn.call(listeners[i].context, event);
    }
  }
}

// Per-pick stamp for the clip-prefilter memo on ancestors (`_clipRayStamp`). Module-global and
// monotonic so stamps never collide across boundaries — a node reparented into another View can't
// present a stale stamp that happens to match that View's own counter.
let _clipPickStamp = 0;

// DOM `Event.eventPhase` values (mirrored by pixi's `FederatedEvent`), stamped on the event while a
// 3D chain walk is in flight.
const CAPTURING_PHASE = 1;
const AT_TARGET = 2;
const BUBBLING_PHASE = 3;

/**
 * Reads a node's on-handler for a dispatch-time key (`'onpointerdown'`, …)
 *
 * The handlers are declared on `Container3D` with their precise event types; this widens the read to
 * the callable shape the dispatcher can invoke with the live federated event.
 * @param node - Node to read the handler from.
 * @param onKey - Handler property name.
 * @returns The handler, or `null` / `undefined` when the node has none.
 */
function onHandlerOf(
  node: Container3D,
  onKey: string,
): ((this: Container3D, event: FederatedMouseEvent) => void) | null | undefined {
  return (
    node as unknown as Record<string, ((this: Container3D, event: FederatedMouseEvent) => void) | null | undefined>
  )[onKey];
}

// One check per process: 3D deliberately ignores pixi's renderer-wide eventMode default (an
// interactive default would put the whole scene on the pick list), and says so once. Registered
// with the global reset seam so a full engine reset re-arms it.
let _warnedDefaultEventMode = false;
GlobalResourceRegistry.register({
  clear: () => {
    _warnedDefaultEventMode = false;
  },
});

/** Multi-click history for one button of one pointer — the source of the 3D `detail` count */
interface Click3DHistory {
  clickCount: number;
  target: Container3D | null;
  timeStamp: number;
}

/**
 * Per-pointer multi-click history, stored on the View outside the pointer records
 *
 * Records are reclaimed on the final release or View exit, but 2D's click counting survives those
 * (its tracking data is never dropped), so a double-click's second tap must find the first tap's
 * count here. Entries whose newest click is older than `MULTI_CLICK_INTERVAL_MS` can no longer
 * extend any count, and are swept when a new pointer's entry is allocated so id-minting browsers
 * don't accumulate one per touch.
 */
interface ClickHistory3D {
  byButton: (Click3DHistory | null)[];
  /** `performance.now()` of the most recent counted click */
  lastClickTime: number;
}

/**
 * Per-pointer interaction state keyed by `pointerId` — the 3D analogue of 2D's `TrackingData`
 *
 * Paths are root-first node arrays (`[root3D, …, target]`), the equivalent of 2D's stored
 * `composedPath()`: they survive scene mutations, and `findMountedTarget3D` later recovers the
 * deepest still-mounted node. Records and their arrays are pooled — steady pointer traffic allocates
 * nothing.
 */
interface PointerRecord3D {
  /**
   * Press propagation path per button, `null` when that button isn't held
   *
   * An empty array records a press on the viewport itself (empty-space press), so the release can
   * still resolve its click target — the View.
   */
  pressPathByButton: (Container3D[] | null)[];
  /** Number of non-`null` `pressPathByButton` entries — gates record teardown */
  heldPressCount: number;
  /** Path of the node this pointer hovers, `null` when nothing is hovered */
  overPath: Container3D[] | null;
  /**
   * `timeStamp` of the last event that touched this record — the staleness
   * bound for the orphaned-record sweep (see `POINTER_RECORD_STALE_MS`)
   */
  lastEventTime: number;
  /**
   * Click target resolved by the release reconciliation, consumed by the
   * click-family dispatches that follow the `pointerup`
   *
   * `null` means the click belongs to the View itself (no 3D chain is emitted).
   */
  clickTarget3D: Container3D | null;
  /** `detail` for the 3D click chain — the per-3D-target count, not pixi's per-View count */
  clickDetail: number;
  /**
   * `nativeEvent` of the release that produced the click stash
   *
   * Pixi's click clone shares it with the `pointerup`, so a matching token proves the arriving click
   * belongs to this release; anything else must not consume the stash.
   */
  clickToken: unknown;
}

/**
 * Resolves the deepest node of a stored path that is still mounted where it was recorded
 *
 * Each entry's `parent` must still point at the previous entry — the 3D port of 2D's
 * `findMountedTarget`. Lets a release or hover flush reach the mounted parent of a node removed
 * mid-interaction.
 * @param path - Root-first path captured when the interaction began.
 * @returns The deepest still-mounted node, or `null` for an empty path (a press on the viewport
 * itself).
 */
function findMountedTarget3D(path: Container3D[]): Container3D | null {
  if (path.length === 0) return null;
  let target = path[0];
  for (let i = 1; i < path.length; i++) {
    if (path[i].parent !== target) break;
    target = path[i];
  }
  return target;
}

/**
 * The 3D counterpart of pixi.js's `EventBoundary`
 *
 * One boundary is created per {@link View3D} by the View's constructor and lives at `view3d.events`.
 * It owns every piece of interaction state for that View — the flat pick list, per-pointer records,
 * hover and press paths, multi-click histories — and translates the federated pointer events pixi
 * delivers to the View into capture / at-target / bubble dispatches along the picked node's 3D parent
 * chain.
 *
 * Pixi's 2D `EventBoundary` remains the event source: the View hit-tests through `_containsPoint`
 * (its `containsPoint` override) and re-enters here through the listeners the constructor registers.
 * Those are plain-key listeners, and pixi notifies a target's `on*` handler and its `*capture`
 * listeners before the plain ones. So the 3D dispatch runs before every user-level
 * `view3d.on('pointerdown', …)` listener, but after a `view3d.onpointerdown` handler or a
 * `view3d.on('pointerdowncapture', …)` listener — those two read the 3D fields as a miss.
 * @example
 * ```ts
 * // Interaction on a 3D node reads the same as it does in 2D.
 * mesh.eventMode = 'static';
 * mesh.cursor = 'pointer';
 * mesh.on('pointertap', (e) => console.log(e.hit3D?.point)); // world-space hit point
 *
 * // The boundary itself is only needed for View-wide settings.
 * view3d.events.enableGlobalMoveEvents = false;
 * ```
 * @see {@link View3D#raycast} For a one-off pick outside the pointer pipeline.
 * @see {@link Event3DFields} For the 3D data carried on the dispatched events.
 * @category events
 * @advanced
 */
export class EventBoundary3D {
  private readonly _view: View3D;

  /**
   * Flat list of every pick-participating `Container3D` in this View: attached, no barrier ancestor
   * (`eventMode: 'none'` or `interactiveChildren: false` — see `getAncestorPickState`), and
   * either `eventMode` static / dynamic / auto or a volume-bearing `'passive'` node under an
   * interactive ancestor
   *
   * Non-interactive entries (auto and passive) are ray-tested but resolve their nearest interactive
   * ancestor as the event target, and are skipped by per-node notifications such as the global-move
   * fan-out. Maintained at mutation time — the `eventMode` / `hitVolume` setters, their subtree
   * cascades, and scene-graph attach / detach — so there is no scene-graph walk at pick time; each
   * node's membership is its `_pickIndex`, its slot in this list. Order is unspecified: a removal
   * swap-fills the freed slot with the last entry.
   * @internal
   */
  public _interactiveList: Container3D[] = [];

  /**
   * Whether interactive 3D nodes receive `globalpointermove` on every pointer move anywhere on the
   * canvas
   *
   * The standard tool for drags that keep tracking after the pointer leaves the object; the
   * `globalmousemove` / `globaltouchmove` aliases come with it. Mirrors 2D's
   * `EventBoundary.enableGlobalMoveEvents`, and additionally requires pixi's own global-move feature
   * to be on, since the View receives the fan-out source event from the 2D system.
   * @remarks
   * - Each interactive node is notified exactly once per move, in registration order — unspecified,
   *   so don't rely on it.
   * - Cost is O(interactive nodes) per move; turn it off when unused in crowded scenes.
   * @default true
   */
  public enableGlobalMoveEvents = true;

  /** Number of nodes in `_interactiveList` with `eventMode: 'dynamic'` */
  private _dynamicPickCount = 0;

  /**
   * Number of attached nodes in this View with an explicit `hitVolume` (`_hitVolumeInput !== null`)
   *
   * Explicit volumes clip their descendants (see {@link Container3D#hitVolume}), so while this is 0
   * the pick loop skips all clip work beyond this one counter check. Maintained by the `hitVolume`
   * setter (attached `null` ↔ non-`null` transitions) and by `View3D._attach` / `_detach` for volumes
   * carried in or out with a subtree.
   * @internal
   */
  public _clipVolumeCount = 0;

  /**
   * The event target resolved by the most recent `containsPoint` call — the hit node itself, or its
   * nearest interactive ancestor when the ray struck a non-interactive (`'auto'` / `'passive'`)
   * node — or `null` on viewport miss
   *
   * Single-slot on purpose: pixi hit-tests immediately before each dispatch, so this is always
   * coherent with the event in flight. Per-pointer state lives in `_pointerRecords`.
   * @internal
   */
  public _currentPick3D: Container3D | null = null;

  /**
   * The user-set shape restricting the View's interactive region, in View-local 2D space — the body
   * of {@link View3D#hitArea}, or `null` when unset
   * @internal
   */
  public _hitAreaShape: IHitArea | null = null;

  /**
   * The hit area the View actually hands to pixi while `_hitAreaShape` is set
   *
   * Pixi's `hitTestFn` short-circuits on a truthy `hitArea` without ever calling `containsPoint`, so
   * the 3D pick refresh has to ride the one hook that still runs — `hitPruneFn`'s
   * `hitArea.contains` — hence the shape test and the pick refresh live in this one object.
   * @internal
   */
  public readonly _hitAreaProxy: IHitArea = {
    contains: (x, y) => {
      const shape = this._hitAreaShape;
      if (shape !== null && !shape.contains(x, y)) {
        this._currentPick3D = null;
        return false;
      }
      return this._containsPoint(x, y);
    },
  };

  /** Per-pointer interaction records (hover, press paths), keyed by `pointerId` */
  private readonly _pointerRecords = new Map<number, PointerRecord3D>();

  /** Recycled records — steady-state pointer traffic allocates nothing */
  private readonly _recordPool: PointerRecord3D[] = [];

  /** Recycled path arrays backing press / hover paths */
  private readonly _pathPool: Container3D[][] = [];

  /** Multi-click histories keyed by `pointerId` — these outlive the pointer records */
  private readonly _clickHistories = new Map<number, ClickHistory3D>();

  /** Recycled `ClickHistory3D` entries */
  private readonly _clickHistoryPool: ClickHistory3D[] = [];

  /**
   * Validity token + pick of the last `pointermove` dispatched through this View
   *
   * `_dispatchGlobalMove` re-derives the fan-out's 3D fields from these instead of trusting the pooled
   * event's shared field storage, which any View3D on the stage may have written last.
   */
  private _movePickToken: unknown = TOKEN_NONE;
  private _movePick3D: Container3D | null = null;

  /**
   * The view's own cursor, shown on viewport miss
   *
   * Stored here rather than via `super.cursor`: pixi's `Container.cursor` is type-only (no runtime
   * property), so a super-assignment would plant an own data property on the instance that permanently
   * shadows the `cursor` accessors below.
   */
  private _cursorFallback: Cursor | (string & {}) | undefined;

  /**
   * The pick behind `_currentPick3D` — the hit the last `_containsPoint` ray cast produced, copied
   * into every event the dispatcher stamps for it
   *
   * `raycast` fills its own result object instead, so a `raycast` call inside a listener cannot
   * change what the rest of that event's dispatches report.
   */
  private readonly _lastHit: RaycastHit3D = createRaycastHit3D();

  /** Scratch ray, matrices and hit result for picking — a pool of one per View3D */
  private readonly _scratchWorldRay = new Ray();
  private readonly _scratchGlobal = new Vector2();
  private readonly _scratchLocalRay = new Ray();
  private readonly _scratchNormalMatrix = new Matrix4();
  private readonly _scratchWorldPoint = new Vector3();
  private readonly _scratchCenter = new Vector3();
  private readonly _scratchHit: HitResult3D = createHitResult3D();
  // Dedicated clip scratch: the prefilter runs between the candidate's broadphase and narrowphase,
  // and the containment walk runs while `_scratchWorldPoint` holds the winner's hit point — neither
  // may clobber the pick loop's own scratch state.
  private readonly _scratchClipRay = new Ray();
  private readonly _scratchClipPoint = new Vector3();

  constructor(view: View3D) {
    this._view = view;

    // Make the View hit-testable by pixi's EventBoundary. Static by default; registering an
    // `eventMode: 'dynamic'` 3D node upgrades the View to dynamic so the ticker re-picks animated
    // content under a stationary pointer.
    view.eventMode = 'static';

    // Install the 3D dispatcher for each forwarded event type. Registered here so it always fires
    // first among the plain-key listeners (eventemitter3 fires them in registration order), letting
    // it write the event's 3D fields before any user-level `view.on(type, …)` listener runs; the
    // View's own `on*` handler and `*capture` listeners precede it (see the class doc). The type is
    // bound into each closure because
    // pixi's alias dispatches deliver the pooled event under the alias emitter key while `event.type`
    // keeps the primary name.
    for (const type of POINTER_EVENT_TYPES) {
      view.on(type, (event: FederatedPointerEvent) => this._dispatch3DEvent(type, event));
    }
    // Wheel is 2D-parity simple: one propagation from the hit target, no tracking, no cursor
    // interaction. The pick already ran in `_containsPoint`.
    view.on('wheel', (event: FederatedWheelEvent) => this._forwardToPick(event, 'wheel', this._currentPick3D));
    // Global moves are a fan-out, not a chain dispatch: pixi's `all()` notifies the View on every
    // pointermove anywhere on the canvas, and the boundary re-broadcasts to every interactive 3D node.
    view.on('globalpointermove', (event: FederatedPointerEvent) => this._dispatchGlobalMove(event));
  }

  /**
   * Releases every retained `Container3D` reference — per-pointer records, click histories, the pick
   * caches and the flat pick list
   *
   * Called by {@link View3D#destroy}; the boundary itself owns no GPU or DOM resources, and the
   * dispatch listeners live on the View's emitter, which the View's own destroy removes.
   * @internal
   */
  public destroy(): void {
    for (const [id, record] of this._pointerRecords) this._freePointerRecord(id, record);
    this._clickHistories.clear();
    this._clickHistoryPool.length = 0;
    this._recordPool.length = 0;
    this._pathPool.length = 0;
    // Reset each node's list slot: the View is destroyed without detaching its scene, and a stale
    // slot would make the node unregistrable in another View.
    const list = this._interactiveList;
    for (let i = 0; i < list.length; i++) list[i]._pickIndex = -1;
    list.length = 0;
    this._currentPick3D = null;
    this._hitAreaShape = null;
    this._movePick3D = null;
    this._movePickToken = TOKEN_NONE;
    this._clipVolumeCount = 0;
  }

  /**
   * CSS cursor for the View, forwarding the picked 3D node's own cursor — the body of
   * {@link View3D#cursor}
   *
   * Pixi reads `e.target.cursor` to update the canvas CSS cursor and `e.target` stays the View3D
   * through 2D dispatch, so the picked node's cursor has to flow through here. `_currentPick3D` is
   * coherent with the hit test pixi runs immediately before reading the cursor. Reads fall back to the
   * View's own cursor on a viewport miss, so a 3D node whose {@link Container3D#cursor} is `null`
   * shows the View's cursor, where bare 2D would coerce to `'default'`.
   * @returns The picked node's cursor, or the View's own when nothing is picked.
   */
  public get cursor(): Cursor | (string & {}) | undefined {
    return this._currentPick3D?.cursor ?? this._cursorFallback;
  }

  /**
   * Sets the View's own fallback cursor, shown on viewport miss
   * @param value - Cursor the View shows when no 3D node is picked.
   */
  public set cursor(value: Cursor | (string & {}) | undefined) {
    this._cursorFallback = value;
  }

  /**
   * The body of {@link View3D#containsPoint}
   *
   * Pixi calls it for every pointer event after `worldTransform.applyInverse(globalPoint, localPoint)`,
   * so `(x, y)` is in View3D's local 2D space — the same space `updateBounds` places
   * `bounds.minX/maxX` in. It runs the 3D ray cast and caches the picked Container3D on
   * `_currentPick3D`; a viewport miss still resolves to View3D itself as the event target.
   * @param x - View3D-local x.
   * @param y - View3D-local y.
   * @returns Whether the point falls inside the View's 2D rect.
   * @internal
   */
  public _containsPoint(x: number, y: number): boolean {
    // Checked here rather than at construction: the renderer (which sets the global) usually inits
    // after scenes are built, and by the first hit test it definitely has.
    if (!_warnedDefaultEventMode && EventSystem.defaultEventMode !== undefined) {
      _warnedDefaultEventMode = true;
      if (EventSystem.defaultEventMode !== 'passive') {
        warn(
          `The renderer eventMode default ('${EventSystem.defaultEventMode}') applies only to 2D containers; ` +
            "3D nodes default to 'passive'. Set eventMode per node or group.",
        );
      }
    }

    if (!this._inViewRect(x, y)) {
      this._currentPick3D = null;
      return false;
    }

    // Undo the boundary's global -> local mapping with the same cached matrix, recovering
    // `event.global` for `screenToRay`. `skipUpdate` keeps the whole pick on last-render transforms,
    // consistent with the node worldTransforms the ray is tested against, so the user picks what they
    // see.
    const view = this._view;
    view.worldTransform.apply(this._scratchGlobal.set(x, y), this._scratchGlobal);
    view.screenToRay(this._scratchGlobal, this._scratchWorldRay, true);

    this._currentPick3D = this._pickWithWorldRay(this._scratchWorldRay, this._lastHit) ? this._lastHit.target : null;
    return true;
  }

  /**
   * Tests View3D-local `(x, y)` against the View's 2D rect
   *
   * `updateBounds` places local 2D at `minX = -anchor.x * width`, so adding `anchor * size` puts the
   * origin at the View's top-left.
   * @param x - View3D-local x.
   * @param y - View3D-local y.
   * @returns Whether the point is inside the rect.
   */
  private _inViewRect(x: number, y: number): boolean {
    const view = this._view;
    const width = view.width;
    const height = view.height;
    const nx = (x + view.anchor.x * width) / width;
    const ny = (y + view.anchor.y * height) / height;
    return nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
  }

  /**
   * Ray-casts at a 2D global point and returns the closest hit — the body of {@link View3D#raycast}
   *
   * `View3D#raycast` documents the full contract: camera-relative `distance`, last-render transforms,
   * hidden nodes skipped, and hits on non-interactive (`'auto'` / `'passive'`) nodes reported against
   * their interactive ancestor.
   * @param position - 2D global point to cast through (the space of `event.global`).
   * @returns The closest hit, or `null` on a miss or when the point falls outside the View's 2D rect.
   */
  public raycast(position: PointData): RaycastHit3D | null {
    const view = this._view;
    const local = view.worldTransform.applyInverse(position, this._scratchGlobal);
    if (!this._inViewRect(local.x, local.y)) return null;

    view.screenToRay(position, this._scratchWorldRay, true);
    const hit = createRaycastHit3D();
    return this._pickWithWorldRay(this._scratchWorldRay, hit) ? hit : null;
  }

  /**
   * Registers a node on the flat pick list, folding a `'dynamic'` mode into the View's dynamic-node
   * count
   *
   * Called from the `Container3D.eventMode` / `interactiveChildren` / `hitVolume` setters, their
   * subtree cascades, and the `_attach` cascade — for nodes below no barrier that are registered by
   * their own mode (static / dynamic / auto) or are `'passive'` volume-bearing nodes under an
   * interactive ancestor. No-op when the node is already
   * registered: `_pickIndex`, owned by this pair of methods, keeps every path idempotent. Only a
   * node registered by its own mode can be `'dynamic'`; implicit registrations never touch the
   * dynamic count.
   * @param node - Node joining the pick list.
   * @internal
   */
  public _addInteractive(node: Container3D): void {
    if (node._pickIndex !== -1) return;
    node._pickIndex = this._interactiveList.push(node) - 1;
    if (node._eventMode === 'dynamic') this._changeDynamicCount(1);
  }

  /**
   * Removes a node from the pick list and clears any cached pick state pointing at it — the mirror
   * of `_addInteractive`
   *
   * The last entry is swapped into the freed slot, so a removal is O(1) whatever the list size and
   * tearing down a large registered subtree stays linear. That is why list order is unspecified.
   * Called from the same paths as `_addInteractive`; a no-op for nodes not on the list.
   * @param node - Node leaving the pick list.
   * @param wasDynamic - The mode the node was registered under. The `eventMode` setter passes this
   * explicitly, since the node's `_eventMode` has already changed by the time this runs; other callers
   * rely on the default, which reads the current mode.
   * @internal
   */
  public _removeInteractive(node: Container3D, wasDynamic: boolean = node._eventMode === 'dynamic'): void {
    const idx = node._pickIndex;
    if (idx === -1) return;
    const list = this._interactiveList;
    const last = list.pop()!;
    if (last !== node) {
      list[idx] = last;
      last._pickIndex = idx;
    }
    node._pickIndex = -1;
    this._clearPickState(node);
    if (wasDynamic) this._changeDynamicCount(-1);
  }

  /**
   * Tracks how many registered 3D nodes are `eventMode: 'dynamic'` and mirrors that onto the View's
   * own 2D `eventMode`
   *
   * Pixi's EventsTicker then drives synthetic pointermoves — re-picks under a stationary pointer —
   * only while some 3D content needs them. Only the static ↔ dynamic pair is auto-managed; a user-set
   * `'none'` / `'passive'` on the View is respected.
   * @param delta - Change in the dynamic-node count.
   * @internal
   */
  public _changeDynamicCount(delta: number): void {
    this._dynamicPickCount += delta;
    const want = this._dynamicPickCount > 0 ? 'dynamic' : 'static';
    const cur = this._view.eventMode;
    if ((cur === 'static' || cur === 'dynamic') && cur !== want) {
      this._view.eventMode = want;
    }
  }

  /**
   * Drops `node` from the current-pick cache when it leaves interaction — detached, or made
   * non-interactive
   *
   * Cleared silently: no `pointerout` is synthesised, since emitting events from a scene mutation
   * would be surprising. Press and hover paths in the per-pointer records are deliberately left
   * alone — they store full root-first paths precisely so a later release or hover flush can resolve
   * the deepest still-mounted ancestor via `findMountedTarget3D`, matching 2D's unmounted-target
   * handling.
   * @param node - Node leaving interaction.
   * @internal
   */
  public _clearPickState(node: Container3D): void {
    if (this._currentPick3D === node) this._currentPick3D = null;
    if (this._movePick3D === node) this._movePick3D = null;
  }

  /**
   * The core pick loop
   *
   * Iterates the flat interactive list, transforms the world ray into each node's local space, calls
   * `intersectRayHitVolume` and tracks the closest hit, whose world-space details land in `out`.
   *
   * Depth-sorting and the reported distance are done in **world space**: the ray transformed into a
   * node's local space has its direction renormalised (so the per-volume `t` is in that node's local
   * units), which would mis-sort nodes of differing scale and report scaled distances. Each hit point
   * is converted to world instead, and true world distances compared.
   *
   * Ancestor clipping (explicit `hitVolume`s clip their descendants, see {@link Container3D#hitVolume})
   * runs in two phases, both skipped entirely while `_clipVolumeCount` is 0: a memoized conservative
   * ray-vs-clip-volume prefilter before each candidate's narrowphase (`_passesClipPrefilter`), and an
   * exact containment test on the winning hit point inside `_resolvePickTarget`. A clipped candidate
   * is skipped without occluding, like any pruned subtree.
   * @param worldRay - The pick ray, in world space.
   * @param out - Hit to fill with the winner, `target` included, on success; untouched on a miss.
   * @returns Whether the ray hit anything.
   */
  private _pickWithWorldRay(worldRay: Ray, out: RaycastHit3D): boolean {
    const list = this._interactiveList;
    const ox = worldRay.origin.x;
    const oy = worldRay.origin.y;
    const oz = worldRay.origin.z;
    // One stamp per pick: each clip ancestor is ray-tested at most once, however many descendants it
    // covers. 0 = clipping inactive.
    const clipStamp = this._clipVolumeCount > 0 ? ++_clipPickStamp : 0;

    let bestDistance = Infinity;
    let bestNode: Container3D | null = null;
    // The node the winning ray test actually struck. Usually `bestNode`; for an `'auto'` hit it is the
    // auto node while `bestNode` is the reported interactive ancestor — surface data (localPoint,
    // normal space) belongs to the struck node.
    let bestSurfaceNode: Container3D | null = null;
    let bestHasSurface = false;

    for (let i = 0; i < list.length; i++) {
      const node = list[i];
      // Explicit hitVolume, else the node's default shape (a Mesh3D's live geometry AABB). Interactive
      // plain containers have no default — they are bubble-only targets, matching a 2D Container
      // without a hitArea.
      const volume = node._hitVolumeResolved ?? node._getDefaultHitVolume();
      if (!volume) continue;
      // Hidden nodes neither pick nor occlude — mirrors pixi 2D hit-testing, which skips invisible
      // subtrees. `worldVisible` is the 0|1 mask resolved by the transform pass (ancestors included),
      // so this carries the same last-frame contract as the world matrices used below.
      if (node._worldVisible === 0) continue;

      // Broadphase: reject against a conservative world-space bounding sphere centred on the node's
      // world translation. Squared space throughout, so missed nodes fall out with no matrix inverse
      // and no ray transform; a pass still runs the exact test below.
      const wt = node.worldTransform.elements;
      this._scratchCenter.set(wt[12], wt[13], wt[14]);
      const radiusSq = hitVolumeBoundingRadiusSq(volume) * node._getWorldScaleSq();
      if (worldRay.distanceSqToPoint(this._scratchCenter) > radiusSq) continue;

      // Clip prefilter: when the ray misses any clip ancestor's volume outright, no point on the
      // candidate can be contained in it — skip before paying for the narrowphase.
      if (clipStamp !== 0 && !this._passesClipPrefilter(node, worldRay, clipStamp)) continue;

      worldRay.applyMatrix4(node._getInverseWorldTransform(), this._scratchLocalRay);

      const t = intersectRayHitVolume(this._scratchLocalRay, volume, this._scratchHit);
      if (t < 0) continue;

      // Sort on true world distance; see the method doc for why the per-volume `t` values can't be
      // compared directly.
      this._scratchHit.point.applyAffineMatrix4(node.worldTransform, this._scratchWorldPoint);
      const dx = this._scratchWorldPoint.x - ox;
      const dy = this._scratchWorldPoint.y - oy;
      const dz = this._scratchWorldPoint.z - oz;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance >= bestDistance) continue;

      // Target resolution last: the O(depth) ancestor walk (pruning, `'auto'` redirection and exact
      // clip containment on the hit point) runs only for candidates that beat the current best. A node
      // whose target resolves to `null` (pruned subtree, clipped hit, or `'auto'` with no interactive
      // ancestor) is skipped without occluding.
      const target = this._resolvePickTarget(node, this._scratchWorldPoint);
      if (!target) continue;

      bestDistance = distance;
      bestNode = target;
      bestSurfaceNode = node;
      bestHasSurface = this._scratchHit.triangleIndex !== -1;

      out.point.copyFrom(this._scratchWorldPoint);
      out.localPoint.copyFrom(this._scratchHit.point);
      out.normal.copyFrom(this._scratchHit.normal);
      out.uv.copyFrom(this._scratchHit.uv);
      out.triangleIndex = this._scratchHit.triangleIndex;
    }

    if (!bestNode) return false;

    // Surface normal: local → world via the normal matrix (inverse-transpose of the world matrix), so
    // it stays correct under non-uniform scale. `transpose` writes into a scratch and leaves the
    // node's cached inverse untouched.
    if (bestHasSurface) {
      bestSurfaceNode!._getInverseWorldTransform().transpose(this._scratchNormalMatrix);
      out.normal.transformDirection(this._scratchNormalMatrix);
    } else {
      out.normal.set(0, 0, 0);
    }
    out.target = bestNode;
    out.distance = bestDistance;
    return true;
  }

  /**
   * Resolves the event target a pick on `node` would report, while enforcing ancestor pruning
   *
   * Walks the full parent chain checking `interactiveChildren` and `eventMode: 'none'` — either one on
   * any ancestor makes the node non-pickable, as in 2D — and, for a non-interactive (`'auto'` or
   * implicitly registered `'passive'`) node, records the nearest interactive ancestor along the way.
   * The barrier checks are redundant by construction — barriers unregister their subtrees at mutation
   * time — but they are winner-gated and cheap, and they turn any future registration bookkeeping bug
   * into wasted work instead of a wrong pick. Falls out cheaply on the typical shallow scene.
   *
   * With a `worldPoint`, the same single pass also enforces ancestor clipping: the hit point must lie
   * inside every explicit clip volume on the chain (`_clipContains`), or the pick resolves to `null` —
   * skipped without occluding. Only the pick loop passes a point; point-less call sites (the
   * global-move fan-out) never hit-test and so never clip, matching 2D's broadcast.
   * @param node - Node the ray struck.
   * @param worldPoint - World-space hit point to containment-test against clip ancestors, or `null`
   * to skip clipping.
   * @returns `node` itself when it is interactive, its nearest interactive ancestor when it is not,
   * or `null` when pruned or clipped — including a non-interactive node with no interactive ancestor
   * at all, since 2D likewise hit-tests such nodes only under an interactive ancestor.
   */
  private _resolvePickTarget(node: Container3D, worldPoint: Vector3 | null = null): Container3D | null {
    const clip = worldPoint !== null && this._clipVolumeCount > 0;
    let target = node.isInteractive() ? node : null;
    let cur = node.parent;
    while (cur) {
      if (!cur._interactiveChildren || cur._eventMode === 'none') return null;
      if (clip && cur._hitVolumeInput !== null && !this._clipContains(cur, worldPoint)) return null;
      if (target === null && cur.isInteractive()) target = cur;
      cur = cur.parent;
    }
    return target;
  }

  /**
   * Conservative per-candidate clip test, memoized per pick — the broadphase of ancestor clipping
   *
   * Walks the candidate's parent chain; each ancestor with an explicit volume is ray-tested **once
   * per pick** in its own local space, with the verdict cached on the ancestor under `clipStamp`
   * (`_clipRayStamp` / `_clipRayHit`), so a clip volume covering many descendants costs one test.
   * A miss on any clip ancestor rejects the candidate — no local point of the candidate's volume can
   * lie inside a volume the ray never enters.
   *
   * Shape handling matches the exact containment rule: `Box` and `Sphere` by their analytic ray
   * tests, `Geometry3D` by its `bounds3D` AABB (containment is AABB-based too, so per-triangle work
   * here would be waste), and a custom {@link IHitVolume3D} always passes — its only clip test is
   * `containsPoint` at winner time, since its `raycast` may legitimately miss from inside an
   * unbounded volume.
   * @param node - The candidate about to be narrowphase-tested.
   * @param worldRay - The pick ray, in world space.
   * @param clipStamp - This pick's memo stamp.
   * @returns Whether the candidate survives all clip ancestors' ray tests.
   */
  private _passesClipPrefilter(node: Container3D, worldRay: Ray, clipStamp: number): boolean {
    let cur = node.parent;
    while (cur) {
      const volume = cur._hitVolumeInput !== null ? cur._hitVolumeResolved : null;
      if (volume !== null) {
        if (cur._clipRayStamp !== clipStamp) {
          cur._clipRayStamp = clipStamp;
          const localRay = worldRay.applyMatrix4(cur._getInverseWorldTransform(), this._scratchClipRay);
          // `applyMatrix4` renormalises the direction, so the unit-direction contract of
          // `intersectSphereT` holds under any ancestor scale.
          if (volume instanceof Box) {
            cur._clipRayHit = localRay.intersectBoxT(volume) !== -1;
          } else if (volume instanceof Sphere) {
            cur._clipRayHit = localRay.intersectSphereT(volume) !== -1;
          } else if (volume instanceof Geometry3D) {
            cur._clipRayHit = localRay.intersectBoxT(volume.bounds3D) !== -1;
          } else {
            cur._clipRayHit = true;
          }
        }
        if (!cur._clipRayHit) return false;
      }
      cur = cur.parent;
    }
    return true;
  }

  /**
   * Exact clip containment of a world-space point in one ancestor's explicit volume
   *
   * The point is brought into the ancestor's local space via its cached inverse-world. `Box` and
   * `Sphere` test exactly; `Geometry3D` tests its `bounds3D` AABB — point-in-open-mesh is ill-defined
   * and per-triangle containment is not mobile-viable; a custom {@link IHitVolume3D} clips through
   * its optional `containsPoint`, and never clips without one. An explicit input that resolved to no
   * shape (`_hitVolumeResolved === null`) doesn't clip either.
   * @param ancestor - Ancestor whose explicit volume clips.
   * @param worldPoint - World-space hit point to test.
   * @returns Whether the point lies inside the ancestor's clip volume.
   */
  private _clipContains(ancestor: Container3D, worldPoint: Vector3): boolean {
    const volume = ancestor._hitVolumeResolved;
    if (volume === null) return true;
    const local = worldPoint.applyAffineMatrix4(ancestor._getInverseWorldTransform(), this._scratchClipPoint);
    if (volume instanceof Box) return volume.containsPoint(local);
    if (volume instanceof Sphere) return volume.containsPoint(local);
    if (volume instanceof Geometry3D) return volume.bounds3D.containsPoint(local);
    return volume.containsPoint === undefined || volume.containsPoint(local);
  }

  /**
   * First-registered plain-key listener for every forwarded pointer event type
   *
   * Runs before any user-level `view.on(type, …)` listener so it can populate the event's 3D fields
   * and re-emit the event along the picked node's 3D parent chain. The View's `on*` handler and
   * `*capture` listeners run earlier (pixi's notify order) and see the fields as a miss.
   *
   * Interaction state is tracked per pointer (see `PointerRecord3D`): hover diffs, press paths
   * (per button) and multi-click counts are keyed by `event.pointerId`, so simultaneous touches — and
   * simultaneous buttons of one mouse — never disturb each other. Records are pooled; a record is
   * reclaimed on the final outside release, on `pointerout` while no press is held, or by the
   * staleness sweep once abandoned (see `POINTER_RECORD_STALE_MS`). Multi-click history lives
   * outside the records (see `ClickHistory3D`) so `detail` counting spans record teardowns, as
   * 2D's never-dropped tracking data does.
   *
   * Release semantics mirror 2D's `mapPointerUp`: `pointerup` propagates from the release pick first;
   * then, when the (mounted) press target isn't in the release chain, `pointerupoutside` and its
   * legacy alias are notified per node from the press target up to — excluding — the nearest common
   * ancestor; that ancestor becomes the click target, and the click family (`click` / `rightclick` /
   * `tap` / `pointertap`) is re-rooted there rather than at whatever node the release happened to land
   * on. This reconciliation runs during the primary `pointerup` dispatch, so the legacy `mouseup` /
   * `touchend` chains arrive after the upoutside walk, where 2D dispatches them before it.
   *
   * `pointercancel` never reaches this dispatcher — pixi's federated layer doesn't deliver it (see
   * `POINTER_EVENT_TYPES`); a cancelled pointer's record is bounded by the `pointerout` sweep,
   * pointer-id reuse on the next press, and the staleness sweep for browsers that never reuse ids.
   * @param type - Emitter key the dispatch arrived under, which for pixi's alias dispatches differs
   * from `event.type`.
   * @param event - The live pooled federated event.
   */
  private _dispatch3DEvent(type: Forwarded3DPointerType, event: FederatedPointerEvent): void {
    switch (type) {
      // The pointer left the View — moved onto another 2D element or off the canvas. Pixi won't
      // hit-test us again for this pointer, so the move-driven hover diff can never observe the
      // change: flush this pointer's hover here — `pointerout` bubbling from the hovered node, then
      // `pointerleave` per node all the way to root3D, with the mouse aliases for mouse/pen (2D's
      // `mapPointerOut` shape). Held presses keep the record alive, so a later `*upoutside` still
      // routes the release back to the press target.
      case 'pointerout': {
        const record = this._pointerRecords.get(event.pointerId);
        let stopped = false;
        if (record) {
          record.lastEventTime = event.timeStamp;
          const prev = record.overPath ? findMountedTarget3D(record.overPath) : null;
          if (record.overPath) {
            this._releasePath(record.overPath);
            record.overPath = null;
          }
          this._writeFields(event, prev, null);
          if (prev) {
            const isMouse = event.pointerType === 'mouse' || event.pointerType === 'pen';
            stopped = this._emit3DChain(event, 'pointerout', prev);
            if (isMouse) this._emit3DChain(event, 'mouseout', prev);
            this._emitEnterLeaveWalk(event, prev, null, false, isMouse);
          }
          if (record.heldPressCount === 0) this._freePointerRecord(event.pointerId, record);
        } else {
          this._writeFields(event, null, null);
        }
        this._currentPick3D = null;
        // A 3D stop in the primary `pointerout` chain (not the mouse alias or the leave walk) silences
        // the View like every other main dispatch — this *is* the View's own out event.
        if (stopped) this._stopViewPropagation(event);
        return;
      }

      // The pointer entered the View — pixi dispatches `pointerover` at the View both on canvas entry
      // and when the pointer slides in from another 2D element, always right after a fresh hit test.
      // Seed this pointer's hover immediately (`pointerover` bubbling, then `pointerenter` per node up
      // to root3D — 2D's `mapPointerOver` shape) instead of waiting for the first `pointermove`.
      case 'pointerover': {
        const pick = this._currentPick3D;
        if (!pick) {
          this._writeFields(event, null, null);
          return;
        }
        const record = this._getPointerRecord(event.pointerId, event.timeStamp);
        const isMouse = event.pointerType === 'mouse' || event.pointerType === 'pen';
        this._writeFields(event, pick, pick);
        const stopped = this._emit3DChain(event, 'pointerover', pick);
        if (isMouse) this._emit3DChain(event, 'mouseover', pick);
        this._emitEnterLeaveWalk(event, pick, null, true, isMouse);
        if (record.overPath) this._releasePath(record.overPath);
        record.overPath = this._capturePath(pick);
        // As for `pointerout` above: a stop in the primary chain silences the View; the alias and
        // enter walk don't count (2D parity).
        if (stopped) this._stopViewPropagation(event);
        return;
      }

      case 'pointerdown': {
        const pick = this._currentPick3D;
        const record = this._getPointerRecord(event.pointerId, event.timeStamp);
        const button = event.button ?? 0;
        // Overwrite semantics match 2D: a re-down on a held button replaces the stored path. A miss
        // stores the empty path — the press belongs to the viewport itself and the release must know a
        // press happened.
        const prevPath = record.pressPathByButton[button];
        if (prevPath) this._releasePath(prevPath);
        else record.heldPressCount++;
        record.pressPathByButton[button] = pick ? this._capturePath(pick) : this._acquirePath();
        // A new press invalidates any click stash from the previous release.
        record.clickToken = TOKEN_NONE;
        this._forwardToPick(event, type, pick);
        return;
      }

      case 'pointermove': {
        const pick = this._currentPick3D;
        // Anchor for the global-move fan-out: proof that this native event's pick ran on *this* View.
        // The fan-out must never trust field storage another View sharing the pooled event may have
        // written.
        this._movePickToken = event.nativeEvent;
        this._movePick3D = pick;
        let record = this._pointerRecords.get(event.pointerId);
        if (!record && pick) record = this._getPointerRecord(event.pointerId, event.timeStamp);
        if (record) {
          record.lastEventTime = event.timeStamp;
          // Hover diff against this pointer's own record — pixi's composedPath diff only sees 2D
          // nodes, so cross-3D-node hover transitions need our help. The stored path resolves through
          // `findMountedTarget3D`, so a hover target detached mid-hover flushes via its mounted
          // ancestor (2D parity).
          const prev = record.overPath ? findMountedTarget3D(record.overPath) : null;
          if (prev !== pick) {
            // 2D hover-change order: `pointerout` (bubbling) → `pointerleave` (per node) →
            // `pointerover` (bubbling) → `pointerenter` (per node), each pointer chain followed by its
            // mouse alias for mouse/pen. `target3D` is written before each family so handlers read the
            // node the chain is about; `hit3D` is the new pick throughout — what the pointer is over now.
            const isMouse = event.pointerType === 'mouse' || event.pointerType === 'pen';
            if (prev) {
              this._writeFields(event, prev, pick);
              this._emit3DChain(event, 'pointerout', prev);
              if (isMouse) this._emit3DChain(event, 'mouseout', prev);
              // Leave fires only when the old target is fully exited — not when the pointer moved down
              // into one of its descendants.
              if (!this._isInChain(prev, pick)) this._emitEnterLeaveWalk(event, prev, pick, false, isMouse);
            }
            if (pick) {
              this._writeFields(event, pick, pick);
              this._emit3DChain(event, 'pointerover', pick);
              if (isMouse) this._emit3DChain(event, 'mouseover', pick);
              // Enter fires unless the new pick is an ancestor of the old target: child → parent moves
              // enter nothing, matching 2D's `didPointerEnter` probe.
              if (!prev || !this._isInChain(pick, prev)) this._emitEnterLeaveWalk(event, pick, prev, true, isMouse);
            }
            if (record.overPath) this._releasePath(record.overPath);
            record.overPath = pick ? this._capturePath(pick) : null;
          }
        }
        this._forwardToPick(event, type, pick);
        return;
      }

      case 'pointerup': {
        // 2D release order: `pointerup` propagates along the release path first, then the press
        // reconciliation (upoutside walk + click target) runs against the stored press path. The
        // release chain is frozen before any listener runs — the 3D analogue of 2D's cached
        // `composedPath()` — so a `pointerup` listener mutating the scene cannot change which nodes
        // count as "on the release chain" for the upoutside walk and the click target.
        const pick = this._currentPick3D;
        const releasePath = pick ? this._capturePath(pick) : null;
        let stopped = false;
        this._writeFields(event, pick, pick);
        if (pick) stopped = this._emit3DChain(event, type, pick, releasePath);
        this._reconcileRelease(event, releasePath, true);
        if (releasePath) this._releasePath(releasePath);
        if (stopped) this._stopViewPropagation(event);
        return;
      }

      // The 2D layer resolved this release outside the View (off-canvas or on another 2D element): no
      // `pointerup`, no click — only the upoutside walk, which runs from the press target all the way
      // to root3D since there is no release chain to stop at (2D parity).
      case 'pointerupoutside':
        // No hit test ran on this View for the release, so there is no pick to report.
        this._writeFields(event, null, null);
        this._reconcileRelease(event, null, false);
        return;

      // Per-node legacy aliases were already interleaved into the primary `pointerupoutside` walk,
      // matching 2D's per-node notify order — these View-level re-notifications carry nothing new.
      case 'mouseupoutside':
      case 'rightupoutside':
      case 'touchendoutside':
        return;

      case 'click':
      case 'rightclick':
      case 'tap':
      case 'pointertap': {
        // Route the click family at the target resolved by the release reconciliation (the
        // press/release common ancestor), not at whatever sits under the pointer — a slide-off release
        // must not click the node it happened to end on. The stash is validated against `nativeEvent`:
        // pixi's click clone shares it with the `pointerup` that produced the click.
        const record = this._pointerRecords.get(event.pointerId);
        if (record && record.clickToken === event.nativeEvent) {
          const target = record.clickTarget3D;
          // `hit3D` is the release pick whatever the click resolved to: a click re-rooted at an
          // ancestor, or at the View itself, still says what the pointer released over.
          this._writeFields(event, target, this._currentPick3D);
          if (!target) {
            // The click resolved to the View itself (empty-viewport press, or a press/release pair
            // with no common 3D node) — no 3D chain; the View's own listeners see `target3D` null.
            return;
          }
          // 3D multi-click count: pixi computed `detail` with the View as the click target; the 3D
          // chain must see the per-3D-target count.
          const originalDetail = event.detail;
          event.detail = record.clickDetail;
          let stopped: boolean;
          try {
            stopped = this._emit3DChain(event, type, target);
          } finally {
            event.detail = originalDetail;
          }
          if (stopped) this._stopViewPropagation(event);
          return;
        }
        // No tracked press behind this click (dispatched without a preceding down/up pair) — degrade
        // to a pass-through on the current pick.
        this._forwardToPick(event, type, this._currentPick3D);
        return;
      }

      // Legacy alias dispatches of an action the primary handler already tracked — re-emit the chain
      // under the alias key, no state changes.
      case 'mousedown':
      case 'rightdown':
      case 'touchstart':
      case 'mousemove':
      case 'touchmove':
      case 'mouseup':
      case 'rightup':
      case 'touchend':
        this._forwardToPick(event, type, this._currentPick3D);
        return;
    }
  }

  /**
   * Writes the event's 3D fields for `pick` and, on a hit, re-emits the event along the picked node's
   * 3D chain
   *
   * The View-propagation stop is applied when a 3D listener halted the chain (see
   * `_stopViewPropagation`). On a miss the fields are still written, so View3D's own listeners — an
   * "empty viewport" click handler, say — read `target3D === null` rather than a stale value left on
   * the pooled event.
   * @param event - The live pooled federated event.
   * @param type - Emitter key to dispatch under.
   * @param pick - Node to dispatch at, or `null` for a viewport miss.
   */
  private _forwardToPick(event: FederatedMouseEvent, type: Chained3DType, pick: Container3D | null): void {
    this._writeFields(event, pick, pick);
    if (pick && this._emit3DChain(event, type, pick)) this._stopViewPropagation(event);
  }

  /**
   * Release-side press reconciliation — the 3D port of the tail of 2D's `mapPointerUp` /
   * `mapPointerUpOutside`
   *
   * Consumes the press path stored for the released button, emits the `pointerupoutside` walk when the
   * (mounted) press target isn't on the release chain, and — for in-View releases — resolves and
   * stashes the click target plus its per-target `detail` for the click-family dispatches that follow.
   *
   * Membership runs against the frozen `releasePath` snapshot, never live parent pointers: 2D tests
   * against the release event's cached `composedPath()`, so `pointerup` listeners mutating the scene
   * must not be able to spawn phantom upoutsides or move the click target.
   * @param event - The release event.
   * @param releasePath - Release chain frozen before the `pointerup` chain dispatched (root-first,
   * `[root3D, …, releasePick]`), or `null` when the release didn't hit a 3D node — empty viewport, or
   * the 2D layer resolved the release outside the View.
   * @param insideView - Whether the release landed on the View, and so can produce a click.
   */
  private _reconcileRelease(
    event: FederatedPointerEvent,
    releasePath: Container3D[] | null,
    insideView: boolean,
  ): void {
    const record = this._pointerRecords.get(event.pointerId);
    if (record) record.lastEventTime = event.timeStamp;
    const button = event.button ?? 0;
    const pressPath = record ? record.pressPathByButton[button] : null;
    if (!record || !pressPath) return;

    const pressTarget = findMountedTarget3D(pressPath);
    record.pressPathByButton[button] = null;
    record.heldPressCount--;
    this._releasePath(pressPath);

    // The click target is the nearest common ancestor of press and release — the press target itself
    // when the release landed on it (or under it). `null` stands for the View, the implicit ancestor
    // of every 3D node; an empty-space press resolves here, so no 3D node gets the click.
    let clickTarget = pressTarget;
    if (pressTarget && (releasePath === null || !releasePath.includes(pressTarget))) {
      clickTarget = this._emitUpOutsideWalk(event, pressTarget, releasePath);
    }

    if (insideView) {
      record.clickTarget3D = clickTarget;
      record.clickDetail = clickTarget ? this._countClick(event.pointerId, button, clickTarget) : 0;
      record.clickToken = event.nativeEvent;
    } else if (record.heldPressCount === 0) {
      // Final release with the pointer outside the View: nothing can reference this record again (2D
      // dispatches no click after an outside release), so reclaim it now. In-View releases keep the
      // record — the pointer is still over the View and the click stash is about to be consumed; the
      // record falls to the `pointerout` sweep later.
      this._freePointerRecord(event.pointerId, record);
    }
  }

  /**
   * Emits `pointerupoutside` from `pressTarget` up to, and excluding, the first ancestor on the frozen
   * release path
   *
   * The per-pointer-type legacy alias is interleaved per node exactly as 2D does. Bubble-only: each
   * node is notified directly at `BUBBLING_PHASE` — its on-handler first, then plain-key listeners, no
   * capture pass. Propagation stops are never checked between nodes, but an immediate stop mutes the
   * remaining nodes' multi-listener batches through `notifyListeners3D` (both 2D parity). `target3D`
   * names the press target for the walk and is restored after; `hit3D` stays the release pick — what
   * the pointer released over, if anything.
   * @param event - The release event.
   * @param pressTarget - Deepest still-mounted node of the stored press path.
   * @param releasePath - Frozen release chain, or `null` when the release didn't hit a 3D node.
   * @returns The first ancestor on the release path — the click target — or `null` when the walk
   * exhausts the chain, meaning the click belongs to the View.
   */
  private _emitUpOutsideWalk(
    event: FederatedPointerEvent,
    pressTarget: Container3D,
    releasePath: Container3D[] | null,
  ): Container3D | null {
    const pointerType = event.pointerType;
    let aliasType: string | null = null;
    let aliasOnKey = '';
    if (pointerType === 'touch') {
      aliasType = 'touchendoutside';
      aliasOnKey = 'ontouchendoutside';
    } else if (pointerType === 'mouse' || pointerType === 'pen') {
      aliasType = event.button === 2 ? 'rightupoutside' : 'mouseupoutside';
      aliasOnKey = event.button === 2 ? 'onrightupoutside' : 'onmouseupoutside';
    }

    const storage = ensurePick3D(event);
    const e = event as WritableTypeEvent;
    const originalType = e.type;
    const originalTarget = event.target;
    const originalCurrent = event.currentTarget;
    const originalTarget3D = storage.target;
    const originalCurrent3D = storage.currentTarget;
    // The walk's target is the press target, not a chain end, so `composedPath()` recomputes live per
    // call (2D parity) — the save/restore only stops it caching a 3D array past the walk.
    const originalPath = event.path;
    const originalPhase = event.eventPhase;
    const originalStopped = event.propagationStopped;
    const originalImmediate = event.propagationImmediatelyStopped;
    event.propagationStopped = false;
    event.propagationImmediatelyStopped = false;
    event.eventPhase = BUBBLING_PHASE;
    event.target = pressTarget as unknown as FederatedPointerEvent['target'];
    storage.target = pressTarget;

    let cur: Container3D | null = pressTarget;
    try {
      while (cur && (releasePath === null || !releasePath.includes(cur))) {
        // Mirror 2D's notifyTarget gate: only interactive nodes fire.
        if (cur.isInteractive()) {
          event.currentTarget = cur as unknown as FederatedPointerEvent['currentTarget'];
          storage.currentTarget = cur;
          e.type = 'pointerupoutside';
          onHandlerOf(cur, 'onpointerupoutside')?.call(cur, event);
          notifyListeners3D(cur, 'pointerupoutside', event);
          if (aliasType) {
            e.type = aliasType;
            onHandlerOf(cur, aliasOnKey)?.call(cur, event);
            notifyListeners3D(cur, aliasType, event);
          }
        }
        cur = cur.parent;
      }
    } finally {
      e.type = originalType;
      event.target = originalTarget;
      event.currentTarget = originalCurrent;
      storage.target = originalTarget3D;
      storage.currentTarget = originalCurrent3D;
      event.path = originalPath;
      event.eventPhase = originalPhase;
      event.propagationStopped = originalStopped;
      event.propagationImmediatelyStopped = originalImmediate;
    }
    return cur;
  }

  /**
   * Membership test against a chain, O(depth)
   * @param node - Node to look for.
   * @param chainTail - Deepest node of the chain to search, `null` for an empty chain.
   * @returns Whether `node` is `chainTail` or one of its ancestors.
   */
  private _isInChain(node: Container3D, chainTail: Container3D | null): boolean {
    let cur = chainTail;
    while (cur) {
      if (cur === node) return true;
      cur = cur.parent;
    }
    return false;
  }

  /**
   * Multi-click counter, at 2D parity
   *
   * A click on the same 3D target within `MULTI_CLICK_INTERVAL_MS` increments the count,
   * anything else resets it to 1. No positional threshold — 2D has none either. History is keyed by
   * `pointerId` in per-View storage, not on the pooled pointer record, so it survives record teardown:
   * a tap's `pointerout` frees the record, and the double-tap that follows must still count 2.
   * @param pointerId - Pointer the click belongs to.
   * @param button - Button that was released.
   * @param target - Resolved 3D click target.
   * @returns The click count to report as `detail`.
   */
  private _countClick(pointerId: number, button: number, target: Container3D): number {
    const now = performance.now();
    let entry = this._clickHistories.get(pointerId);
    if (!entry) {
      this._sweepClickHistories(now);
      entry = this._clickHistoryPool.pop() ?? { byButton: [], lastClickTime: 0 };
      this._clickHistories.set(pointerId, entry);
    }
    entry.lastClickTime = now;
    let history = entry.byButton[button];
    if (!history) {
      history = entry.byButton[button] = { clickCount: 0, target: null, timeStamp: 0 };
    }
    if (history.target === target && now - history.timeStamp < MULTI_CLICK_INTERVAL_MS) {
      history.clickCount++;
    } else {
      history.clickCount = 1;
    }
    history.target = target;
    history.timeStamp = now;
    return history.clickCount;
  }

  /**
   * Reclaims click histories older than the multi-click window
   *
   * They can no longer extend any count, so dropping them is invisible. Runs only when a new pointer's
   * history is allocated, so browsers that mint a fresh `pointerId` per touch don't accumulate one
   * entry per tap.
   * @param now - Current `performance.now()`.
   */
  private _sweepClickHistories(now: number): void {
    for (const [id, entry] of this._clickHistories) {
      if (now - entry.lastClickTime >= MULTI_CLICK_INTERVAL_MS) {
        const byButton = entry.byButton;
        for (let i = 0; i < byButton.length; i++) {
          const history = byButton[i];
          if (history) {
            history.clickCount = 0;
            history.target = null;
            history.timeStamp = 0;
          }
        }
        this._clickHistoryPool.push(entry);
        this._clickHistories.delete(id);
      }
    }
  }

  /**
   * Silences the View's own listeners after a 3D listener stopped the main dispatch chain
   *
   * View3D is an ancestor of every 3D node, so it must go quiet too — but pixi only checks
   * `propagationStopped` *between* 2D targets, and the View's own user listeners sit in the same
   * emitter batch as this dispatcher. Setting `propagationImmediatelyStopped` as well makes pixi's
   * listener loop skip the remainder of that batch. The caveat is that this silences *every*
   * View-level listener for the event; one registered ahead of the others cannot be exempted.
   * @param event - Event to mark as stopped.
   */
  private _stopViewPropagation(event: FederatedMouseEvent): void {
    event.propagationStopped = true;
    event.propagationImmediatelyStopped = true;
  }

  /**
   * Returns the record for `pointerId`, creating one — or reviving it from the pool — when absent
   *
   * A new pointer is also the sweep point for abandoned records: on browsers that never reuse touch
   * pointerIds, a cancelled touch's record can only be reclaimed here, since pixi never delivers
   * `pointercancel`.
   * @param pointerId - Pointer to look up.
   * @param now - The event's `timeStamp`, stamped onto the record.
   * @returns The live record for this pointer.
   */
  private _getPointerRecord(pointerId: number, now: number): PointerRecord3D {
    let record = this._pointerRecords.get(pointerId);
    if (!record) {
      this._sweepStaleRecords(now);
      record = this._recordPool.pop() ?? {
        pressPathByButton: [],
        heldPressCount: 0,
        overPath: null,
        lastEventTime: 0,
        clickTarget3D: null,
        clickDetail: 0,
        clickToken: TOKEN_NONE,
      };
      this._pointerRecords.set(pointerId, record);
    }
    record.lastEventTime = now;
    return record;
  }

  /**
   * Reclaims records that have seen no events for `POINTER_RECORD_STALE_MS`
   * @param now - The event's `timeStamp`.
   */
  private _sweepStaleRecords(now: number): void {
    for (const [id, record] of this._pointerRecords) {
      if (now - record.lastEventTime >= POINTER_RECORD_STALE_MS) this._freePointerRecord(id, record);
    }
  }

  /**
   * Returns a record, and its path arrays, to the pools
   * @param pointerId - Pointer the record is keyed under.
   * @param record - The record to reset and pool.
   */
  private _freePointerRecord(pointerId: number, record: PointerRecord3D): void {
    this._pointerRecords.delete(pointerId);
    const paths = record.pressPathByButton;
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      if (path) {
        this._releasePath(path);
        paths[i] = null;
      }
    }
    record.heldPressCount = 0;
    if (record.overPath) {
      this._releasePath(record.overPath);
      record.overPath = null;
    }
    record.clickTarget3D = null;
    record.clickDetail = 0;
    record.clickToken = TOKEN_NONE;
    this._recordPool.push(record);
  }

  /**
   * Pops a pooled path array, allocating on first use
   * @returns An empty array ready to hold a propagation path.
   */
  private _acquirePath(): Container3D[] {
    return this._pathPool.pop() ?? [];
  }

  /**
   * Clears a path array and returns it to the pool
   * @param path - Array to reclaim.
   */
  private _releasePath(path: Container3D[]): void {
    path.length = 0;
    this._pathPool.push(path);
  }

  /**
   * Captures `node`'s propagation path into a pooled array
   * @param node - Node the path ends at.
   * @returns The root-first path, `[root3D, …, node]`.
   */
  private _capturePath(node: Container3D): Container3D[] {
    const path = this._acquirePath();
    let cur: Container3D | null = node;
    while (cur) {
      path.push(cur);
      cur = cur.parent;
    }
    path.reverse();
    return path;
  }

  /**
   * Stamps the event's 3D fields for a dispatch, and the validity token that makes them readable
   * @param event - Event to write into.
   * @param target - Node to report as `target3D`: the dispatch target, or `null` when the event
   * belongs to the View itself.
   * @param pick - The View's pick for this event — the node `_lastHit` describes — reported as
   * `hit3D`; `null` when the ray struck nothing or no ray was cast, so `hit3D` reads `null`.
   */
  private _writeFields(event: FederatedMouseEvent, target: Container3D | null, pick: Container3D | null): void {
    const s = ensurePick3D(event);
    if (pick !== null) copyRaycastHit3D(this._lastHit, s.hit);
    s.hasHit = pick !== null;
    s.target = target;
    s.token = event.nativeEvent;
  }

  /**
   * Runs a full three-phase dispatch of `type` along `from`'s 3D chain, exactly as 2D's `propagate`
   * does
   *
   * Capture (root → parent-of-target, under the `'${type}capture'` emitter key), at-target (both
   * keys), then bubble (plain key) — maintaining `event.eventPhase` throughout and honoring a
   * propagation stop between nodes. Per node, 2D's `notifyTarget` shape applies: non-interactive nodes
   * are walked but silent, and the node's `'on' + type` handler runs before its emitter listeners in
   * every phase, so an ancestor's on-handler fires in both the capture and bubble passes (2D quirk,
   * kept for parity). Listeners are delivered through `notifyListeners3D`, so
   * `stopImmediatePropagation` is honored *between a node's own listeners* — including between the
   * capture-key and plain-key sets at the target — with 2D's single-listener fast-path quirk intact.
   * An unused capture pass costs one property read and one map lookup per ancestor.
   *
   * The chain is snapshotted into a pooled root-first array before any listener runs, so mid-dispatch
   * reparenting can't corrupt the walk — the 3D analogue of 2D's frozen `composedPath`. The snapshot
   * is installed as `event.path` for the duration of the walk, so a listener calling `composedPath()`
   * reads the exact frozen chain being dispatched rather than triggering pixi's live-`.parent`
   * recompute (which allocates and would reflect mid-dispatch reparents).
   *
   * For the duration of the walk `event.target` / `event.currentTarget` / `event.type` /
   * `event.eventPhase` are set to 3D values and restored afterwards, so handlers see correct values
   * and pixi's continued 2D dispatch isn't disturbed. Propagation flags are reset at entry — each call
   * is a distinct dispatch, a synthesised `pointerover` being independent of the `pointermove` that
   * triggered it — and restored on exit, so a stop inside a synthesised chain can't leak into the
   * surrounding 2D dispatch.
   * @param event - The live pooled federated event.
   * @param type - Emitter key to dispatch under.
   * @param from - Node at the end of the chain — the dispatch target.
   * @param frozenPath - Chain snapshot pre-captured by the caller, who keeps ownership and releases
   * it. The release flow shares one snapshot between its dispatch and its reconciliation.
   * @returns Whether a listener stopped the chain. Callers dispatching the *main* event apply
   * `_stopViewPropagation` with it; synthesised chains ignore it.
   */
  private _emit3DChain(
    event: FederatedMouseEvent,
    type: Chained3DType,
    from: Container3D,
    frozenPath?: Container3D[] | null,
  ): boolean {
    // `currentTarget3D` tracks `event.currentTarget` through the walk — the cast-written
    // `currentTarget` is statically typed `Container`, so the typed hop lives in the 3D storage.
    const storage = ensurePick3D(event);
    const e = event as WritableTypeEvent;
    const originalType = e.type;
    const originalTarget = event.target;
    const originalCurrent = event.currentTarget;
    const originalCurrent3D = storage.currentTarget;
    const originalPath = event.path;
    const originalPhase = event.eventPhase;
    const originalStopped = event.propagationStopped;
    const originalImmediate = event.propagationImmediatelyStopped;

    event.propagationStopped = false;
    event.propagationImmediatelyStopped = false;
    e.type = type;
    event.target = from as unknown as FederatedMouseEvent['target'];

    const { onKey, captureKey } = CHAIN_KEYS[type];
    const ownsPath = frozenPath === undefined || frozenPath === null;
    const path = frozenPath ?? this._capturePath(from);
    event.path = path as unknown as FederatedMouseEvent['path'];
    let stopped = false;

    try {
      event.eventPhase = CAPTURING_PHASE;
      for (let i = 0, last = path.length - 1; i < last; i++) {
        const cur = path[i];
        if (!cur.isInteractive()) continue;
        event.currentTarget = cur as unknown as FederatedMouseEvent['currentTarget'];
        storage.currentTarget = cur;
        onHandlerOf(cur, onKey)?.call(cur, event);
        notifyListeners3D(cur, captureKey, event);
        if (event.propagationStopped || event.propagationImmediatelyStopped) {
          stopped = true;
          break;
        }
      }

      // 2D's notifyTarget fires both the capture-key and plain-key listener sets at AT_TARGET, and an
      // immediate stop in the first set mutes the second's array path.
      if (!stopped && from.isInteractive()) {
        event.eventPhase = AT_TARGET;
        event.currentTarget = from as unknown as FederatedMouseEvent['currentTarget'];
        storage.currentTarget = from;
        onHandlerOf(from, onKey)?.call(from, event);
        notifyListeners3D(from, captureKey, event);
        notifyListeners3D(from, type, event);
        if (event.propagationStopped || event.propagationImmediatelyStopped) stopped = true;
      }

      if (!stopped) {
        event.eventPhase = BUBBLING_PHASE;
        for (let i = path.length - 2; i >= 0; i--) {
          const cur = path[i];
          if (!cur.isInteractive()) continue;
          event.currentTarget = cur as unknown as FederatedMouseEvent['currentTarget'];
          storage.currentTarget = cur;
          onHandlerOf(cur, onKey)?.call(cur, event);
          notifyListeners3D(cur, type, event);
          if (event.propagationStopped || event.propagationImmediatelyStopped) {
            stopped = true;
            break;
          }
        }
      }
    } finally {
      if (ownsPath) this._releasePath(path);
      e.type = originalType;
      event.target = originalTarget;
      event.currentTarget = originalCurrent;
      storage.currentTarget = originalCurrent3D;
      event.path = originalPath;
      event.eventPhase = originalPhase;
      event.propagationStopped = originalStopped;
      event.propagationImmediatelyStopped = originalImmediate;
    }
    return stopped;
  }

  /**
   * The non-bubbling enter/leave walk shared by the hover diff, the View-entry seed and the View-exit
   * flush
   *
   * Notifies `pointerenter` or `pointerleave` — plus the `mouseenter` / `mouseleave` alias for
   * mouse/pen, interleaved per node exactly as 2D does — walking up from `from`:
   *
   * - enter: up to, and excluding, `boundary` (the previous hover target), or all the way to root3D
   *   when `boundary` is `null` (first hover / View entry).
   * - leave: up to, and excluding, the first ancestor on `boundary`'s chain (the node the pointer is
   *   still over), all the way to root3D when `boundary` is `null` (the pointer left the View).
   *
   * Each node is notified as its own target at `AT_TARGET` phase, so its `*capture` listeners fire
   * alongside the plain ones (2D quirk), with the node's on-handler first. Propagation stops are never
   * checked between nodes, but an immediate stop mutes the remaining nodes' multi-listener batches
   * through `notifyListeners3D` (both 2D parity). The event's dispatch state — including the `target3D`
   * field, which tracks the notified node — is restored afterwards.
   * @param event - The live pooled federated event.
   * @param from - Node the walk starts at.
   * @param boundary - Node the walk stops below, or `null` to walk to root3D.
   * @param enter - `true` to notify `pointerenter`, `false` for `pointerleave`.
   * @param isMouse - Whether to interleave the `mouseenter` / `mouseleave` aliases.
   */
  private _emitEnterLeaveWalk(
    event: FederatedMouseEvent,
    from: Container3D,
    boundary: Container3D | null,
    enter: boolean,
    isMouse: boolean,
  ): void {
    const type = enter ? 'pointerenter' : 'pointerleave';
    const captureKey = enter ? 'pointerentercapture' : 'pointerleavecapture';
    const onKey = enter ? 'onpointerenter' : 'onpointerleave';
    const aliasType = enter ? 'mouseenter' : 'mouseleave';
    const aliasCaptureKey = enter ? 'mouseentercapture' : 'mouseleavecapture';
    const aliasOnKey = enter ? 'onmouseenter' : 'onmouseleave';

    const storage = ensurePick3D(event);
    const e = event as WritableTypeEvent;
    const originalType = e.type;
    const originalTarget = event.target;
    const originalCurrent = event.currentTarget;
    // No frozen chain here — each visited node is its own target, so a listener's `composedPath()`
    // recomputes live per node (2D parity). The save/restore only stops that recompute from caching a
    // 3D array on the pooled event past the walk.
    const originalPath = event.path;
    const originalPhase = event.eventPhase;
    const originalStopped = event.propagationStopped;
    const originalImmediate = event.propagationImmediatelyStopped;
    const originalTarget3D = storage.target;
    const originalCurrent3D = storage.currentTarget;

    event.propagationStopped = false;
    event.propagationImmediatelyStopped = false;
    event.eventPhase = AT_TARGET;

    let cur: Container3D | null = from;
    try {
      while (cur && (enter ? cur !== boundary : !this._isInChain(cur, boundary))) {
        // Mirror 2D's notifyTarget gate: only interactive nodes fire.
        if (cur.isInteractive()) {
          storage.target = cur;
          storage.currentTarget = cur;
          event.target = cur as unknown as FederatedMouseEvent['target'];
          event.currentTarget = cur as unknown as FederatedMouseEvent['currentTarget'];
          e.type = type;
          onHandlerOf(cur, onKey)?.call(cur, event);
          notifyListeners3D(cur, captureKey, event);
          notifyListeners3D(cur, type, event);
          if (isMouse) {
            e.type = aliasType;
            onHandlerOf(cur, aliasOnKey)?.call(cur, event);
            notifyListeners3D(cur, aliasCaptureKey, event);
            notifyListeners3D(cur, aliasType, event);
          }
        }
        cur = cur.parent;
      }
    } finally {
      storage.target = originalTarget3D;
      storage.currentTarget = originalCurrent3D;
      e.type = originalType;
      event.target = originalTarget;
      event.currentTarget = originalCurrent;
      event.path = originalPath;
      event.eventPhase = originalPhase;
      event.propagationStopped = originalStopped;
      event.propagationImmediatelyStopped = originalImmediate;
    }
  }

  /**
   * Fan-out for `globalpointermove` and its pointer-type alias, fed by pixi's own global-move
   * broadcast to the View
   *
   * Every interactive node — in registration order, non-interactive (`'auto'` / `'passive'`) entries
   * and pruned or hidden subtrees excluded — is notified exactly once per type, directly, with no
   * chain walk: `eventPhase` is forced
   * to `BUBBLING_PHASE` so capture listeners never receive global moves (2D parity), and each node
   * gets its on-handler before its listeners. Unlike 2D, interactive ancestors of the hit target are
   * *not* notified twice, which is an acknowledged 2D bug. Nodes with no global-move listener or
   * on-handler are skipped before any per-node work, so with nothing listening — the common case — the
   * fan-out costs a couple of property reads per node.
   *
   * The 3D fields are written once for the whole fan-out, from this View's own record of the move
   * (`_movePickToken` / `_movePick3D`): the pooled event and its field storage are shared by every
   * View3D on the stage, so a token match alone could be another View's write — world-space data from
   * a different camera. When the move never crossed this View there is no ray and the fields read as a
   * miss.
   * @param event - The global move event pixi broadcast to the View.
   */
  private _dispatchGlobalMove(event: FederatedPointerEvent): void {
    if (!this.enableGlobalMoveEvents) return;
    const list = this._interactiveList;
    if (list.length === 0) return;

    const movePick = this._movePickToken === event.nativeEvent ? this._movePick3D : null;
    this._writeFields(event, movePick, movePick);
    const storage = ensurePick3D(event);

    const pointerType = event.pointerType;
    let aliasType: string | null = null;
    let aliasOnKey = '';
    if (pointerType === 'touch') {
      aliasType = 'globaltouchmove';
      aliasOnKey = 'onglobaltouchmove';
    } else if (pointerType === 'mouse' || pointerType === 'pen') {
      aliasType = 'globalmousemove';
      aliasOnKey = 'onglobalmousemove';
    }

    // `event.target` is left untouched, as 2D's `all()` keeps the 2D hit target; the 3D pick, when
    // there is one, is on `target3D`.
    const e = event as WritableTypeEvent;
    const originalType = e.type;
    const originalCurrent = event.currentTarget;
    const originalCurrent3D = storage.currentTarget;
    const originalPhase = event.eventPhase;
    const originalStopped = event.propagationStopped;
    const originalImmediate = event.propagationImmediatelyStopped;

    event.propagationStopped = false;
    event.propagationImmediatelyStopped = false;
    event.eventPhase = BUBBLING_PHASE;

    try {
      for (let i = 0; i < list.length; i++) {
        const node = list[i];
        // Deaf-node fast path: without any global-move listener or on-handler there is nothing to
        // deliver, so the pruning checks below — `_resolvePickTarget` is an O(depth) ancestor walk —
        // must not run. Skipping them is unobservable: they only decide whether the absent listeners
        // would have been notified.
        const nodeEvents = (node as unknown as EmitterInternal)._events;
        if (
          nodeEvents.globalpointermove === undefined &&
          !node.onglobalpointermove &&
          (aliasType === null || (nodeEvents[aliasType] === undefined && !onHandlerOf(node, aliasOnKey)))
        ) {
          continue;
        }
        if (!node.isInteractive()) continue;
        if (node._worldVisible === 0) continue;
        if (!this._resolvePickTarget(node)) continue;
        event.currentTarget = node as unknown as FederatedPointerEvent['currentTarget'];
        storage.currentTarget = node;
        e.type = 'globalpointermove';
        onHandlerOf(node, 'onglobalpointermove')?.call(node, event);
        notifyListeners3D(node, 'globalpointermove', event);
        if (aliasType) {
          e.type = aliasType;
          onHandlerOf(node, aliasOnKey)?.call(node, event);
          notifyListeners3D(node, aliasType, event);
        }
      }
    } finally {
      e.type = originalType;
      event.currentTarget = originalCurrent;
      storage.currentTarget = originalCurrent3D;
      event.eventPhase = originalPhase;
      event.propagationStopped = originalStopped;
      event.propagationImmediatelyStopped = originalImmediate;
    }
  }
}
