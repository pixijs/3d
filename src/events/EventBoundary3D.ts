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
 * Pointer event types the View passes into its 3D scene
 *
 * Listed out so the hot path never matches string prefixes. Each type gets its own listener
 * closure: pixi sends the alias events (`mousedown`, `touchstart`, `rightup`, …) on the same
 * reused event object, whose `type` still reads the primary name, so only the emitter key names
 * the dispatch.
 *
 * `pointerout` and `pointerover` aren't passed to a picked node. They mean the pointer left or
 * entered the View: `pointerout` clears that pointer's 3D hover, and `pointerover` sets it on
 * entry, so hover events don't wait for the first `pointermove`. The 3D hover events come from
 * those two and the hover check on each move, so pixi's own `mouseover` and `mouseout` on the View
 * add nothing and aren't listened to.
 *
 * `pointercancel` is left out because pixi never delivers it, in 2D either. A cancelled pointer is
 * an abandoned press, and its record is swept once stale (`POINTER_RECORD_STALE_MS`).
 *
 * `wheel` and `globalpointermove` have their own listeners: `wheel` carries a
 * `FederatedWheelEvent`, and a global move goes to every interactive node instead of along a chain.
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
  'contextmenu',
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

/** The members of `POINTER_EVENT_TYPES` */
type Forwarded3DPointerType = (typeof POINTER_EVENT_TYPES)[number];

/**
 * Window for counting repeat clicks, in milliseconds
 *
 * Clicks on the same target within it raise `detail`. As in 2D, there is no distance limit.
 */
const MULTI_CLICK_INTERVAL_MS = 200;

/**
 * How long a pointer record can go without events before it is freed, in milliseconds
 *
 * The check runs when a new pointer appears. Browsers that give each touch a new `pointerId` (iOS
 * Safari, Chrome Android) never reuse an id, and pixi never delivers `pointercancel`, so without
 * it a cancelled touch's record would hold on to its press path forever. It is long because a
 * press held still sends no events, and must survive other fingers tapping around it.
 */
const POINTER_RECORD_STALE_MS = 60_000;

/**
 * Event types `_emit3DChain` dispatches under
 *
 * Every forwarded type except the `*upoutside` ones, whose walk names its own keys, plus
 * `mouseover`, `mouseout` and `wheel`.
 */
type Chained3DType = Exclude<Forwarded3DPointerType, `${string}outside`> | 'mouseover' | 'mouseout' | 'wheel';

/** Emitter and handler-property keys per `Chained3DType`, built once so dispatch never concatenates strings */
const CHAIN_KEYS: Record<Chained3DType, { onKey: string; captureKey: string }> = Object.create(null);
for (const type of [...POINTER_EVENT_TYPES, 'mouseover', 'mouseout', 'wheel'] as const) {
  if (type.endsWith('outside')) continue;
  CHAIN_KEYS[type as Chained3DType] = { onKey: 'on' + type, captureKey: type + 'capture' };
}

/**
 * A listener as `eventemitter3` stores it internally
 *
 * The dispatcher reads `_events` directly, as 2D's `EventBoundary._notifyListeners` does, because
 * `emit` always runs a node's whole listener list and so can't honour `stopImmediatePropagation`
 * between a node's own listeners.
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
 * Calls `node`'s listeners for `key`, a port of 2D's `EventBoundary._notifyListeners`
 *
 * `once` listeners are removed before they run. With several listeners, the loop stops once
 * `propagationImmediatelyStopped` is set. A lone listener skips that check, so it still runs after
 * an immediate stop earlier on the same node, as in 2D. The node is read as a plain emitter, as 2D
 * does, because keys built at dispatch time aren't in the typed `Container3DEvents` map.
 * @param node - Node whose listeners are notified.
 * @param key - Emitter key to fire (`'pointerdown'`, `'pointerdowncapture'`, an alias type, …).
 * @param event - The live federated event, already carrying its 3D fields.
 */
function notifyListeners3D(node: Container3D, key: string, event: FederatedMouseEvent): void {
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

/**
 * Number of the current pick, for the clip memo on ancestors (`_clipRayStamp`)
 *
 * Shared by every View and only ever increasing, so a node moved into another View can't carry an
 * old stamp that happens to match.
 */
let _clipPickStamp = 0;

/** DOM `Event.CAPTURING_PHASE`, as pixi's `FederatedEvent` uses it; set during a 3D capture pass */
const CAPTURING_PHASE = 1;
/** DOM `Event.AT_TARGET`; set while a 3D node is told as the target */
const AT_TARGET = 2;
/** DOM `Event.BUBBLING_PHASE`; set during a 3D bubble pass */
const BUBBLING_PHASE = 3;

/**
 * Reads a node's handler property for a key built at dispatch time (`'onpointerdown'`, …)
 *
 * `Container3D` declares each handler with its exact event type; this widens the read to a
 * function the dispatcher can call with the live federated event.
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

/**
 * Whether a View has warned that the renderer's `eventMode` default doesn't apply to 3D nodes
 *
 * 3D ignores that default on purpose, since an interactive default would put the whole scene on
 * the pick list, and says so once per process. `GlobalResourceRegistry.release()` clears it, so a
 * full reset warns again.
 */
let _warnedDefaultEventMode = false;
GlobalResourceRegistry.register({
  clear: () => {
    _warnedDefaultEventMode = false;
  },
});

/** Repeat-click count for one button of one pointer, which the 3D `detail` reports */
interface Click3DHistory {
  clickCount: number;
  target: Container3D | null;
  timeStamp: number;
}

/**
 * One pointer's click counts, kept on the boundary apart from the pointer records
 *
 * A record is freed on the final release or when the pointer leaves the View, but 2D never drops
 * its click counts, so the second tap of a double tap has to find the first tap's count here. An
 * entry whose last click is older than `MULTI_CLICK_INTERVAL_MS` can't raise any count, so it is
 * swept when a new pointer's entry is made; browsers that give each touch a new `pointerId` then
 * don't pile up one entry per tap.
 */
interface ClickHistory3D {
  byButton: (Click3DHistory | null)[];
  /** `performance.now()` of the last counted click */
  lastClickTime: number;
}

/**
 * What the boundary tracks for one pointer, keyed by `pointerId`; 2D keeps the same in its
 * `TrackingData`
 *
 * Paths are root-first node arrays (`[root3D, …, target]`), like the `composedPath()` 2D stores.
 * They survive changes to the scene, and `findMountedTarget3D` later finds the deepest node still
 * in place. Records and their arrays are pooled, so steady pointer traffic allocates nothing.
 */
interface PointerRecord3D {
  /**
   * Press path per button, `null` while that button isn't held
   *
   * An empty array is a press on empty space, so the release can still find its click target: the
   * View.
   */
  pressPathByButton: (Container3D[] | null)[];
  /** Number of held buttons, the non-`null` entries of `pressPathByButton`; the record is kept while any are */
  heldPressCount: number;
  /** Path of the node this pointer is over, `null` when it is over nothing */
  overPath: Container3D[] | null;
  /** `timeStamp` of the last event for this pointer, checked against `POINTER_RECORD_STALE_MS` */
  lastEventTime: number;
  /**
   * Click target the release worked out, for the click events that follow the `pointerup`
   *
   * `null` means the click belongs to the View itself, and no 3D chain runs.
   */
  clickTarget3D: Container3D | null;
  /** `detail` for the 3D click events: the count for the 3D target, not pixi's count for the View */
  clickDetail: number;
  /**
   * `nativeEvent` of the release that set `clickTarget3D` and `clickDetail`
   *
   * Pixi's click event shares it with the `pointerup`, so a match proves an arriving click belongs
   * to this release; no other click may use them.
   */
  clickToken: unknown;
}

/**
 * Finds the deepest node of a stored path that is still where it was recorded, as 2D's
 * `findMountedTarget` does
 *
 * Each entry's `parent` must still be the entry before it. This lets a release or a hover change
 * reach the nearest ancestor still in place when a node was removed mid-interaction.
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
 * Pointer events for one {@link View3D}, the 3D counterpart of pixi.js's `EventBoundary`
 *
 * Each View makes one, at `view3d.events`. Pixi's event system still delivers events to the View
 * as a 2D object. The View answers pixi's hit test by casting a ray into its scene, and this
 * boundary then sends each event to the picked node and its 3D ancestors, with capture, target and
 * bubble phases as in 2D. It also tracks hover, presses and click counts per pointer.
 *
 * You rarely need it directly: set {@link IFederatedContainer3D#eventMode | eventMode} on nodes
 * and listen on them. It holds the settings that apply to the whole View. The View's own `on*`
 * handlers and `*capture` listeners run before the 3D dispatch; {@link Event3DFields} explains
 * what they see.
 * @example
 * ```ts
 * // Events on a 3D node work as they do in 2D.
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
   * The pick list: every node in this View that a pick tests
   *
   * A node is on it when it is attached, no ancestor is a barrier (`eventMode: 'none'` or
   * `interactiveChildren: false`, see `getAncestorPickState`), and either its `eventMode` is
   * `'static'`, `'dynamic'` or `'auto'`, or it is `'passive'` with a volume under an interactive
   * ancestor.
   *
   * Hits on `'auto'` and `'passive'` entries go to their nearest interactive ancestor, and
   * per-node notifications such as global moves skip them. The list changes when the scene does
   * (the `eventMode`, `interactiveChildren` and `hitVolume` setters, and attach and detach), so a
   * pick never walks the scene. Each node's `_pickIndex` is its slot. The order is unspecified: a
   * removal moves the last entry into the freed slot.
   * @internal
   */
  public _interactiveList: Container3D[] = [];

  /**
   * Whether interactive 3D nodes hear `globalpointermove` on every pointer move over the canvas
   *
   * The usual tool for a drag that keeps tracking after the pointer leaves the object;
   * `globalmousemove` and `globaltouchmove` come with it. It matches 2D's
   * `EventBoundary.enableGlobalMoveEvents`, and also needs pixi's own global moves on (the
   * `eventFeatures.globalMove` renderer option), since the View gets each move from pixi.
   * @remarks
   * - Each interactive, visible node hears each move once, in no particular order.
   * - It costs time per interactive node on every move; turn it off in crowded scenes that don't
   *   use it.
   * @default true
   */
  public enableGlobalMoveEvents = true;

  /** Number of nodes in `_interactiveList` with `eventMode: 'dynamic'` */
  private _dynamicPickCount = 0;

  /**
   * Number of attached nodes in this View with a `hitVolume` set (`_hitVolumeInput !== null`)
   *
   * Those volumes clip their descendants (see {@link Container3D#hitVolume}), so while this is 0 a
   * pick does no clip work beyond checking it. The `hitVolume` setter keeps it up to date while a
   * node is attached, and `View3D._attach` and `_detach` count the volumes a subtree brings in or
   * takes out.
   * @internal
   */
  public _clipVolumeCount = 0;

  /**
   * The event target the last hit test found: the node hit, or its nearest interactive ancestor
   * when the node isn't interactive (`'auto'` or `'passive'`); `null` over empty space
   *
   * One slot is enough: pixi hit-tests right before each dispatch, so it always matches the event
   * in flight. Per-pointer state lives in `_pointerRecords`.
   * @internal
   */
  public _currentPick3D: Container3D | null = null;

  /**
   * The shape set as {@link View3D#hitArea}, in View-local 2D space, or `null`
   * @internal
   */
  public _hitAreaShape: IHitArea | null = null;

  /**
   * The hit area the View gives pixi while `_hitAreaShape` is set
   *
   * Pixi's `hitTestFn` returns early for a container with a `hitArea` and never calls
   * `containsPoint`, so the 3D pick has to run from the one hook that still does:
   * `hitArea.contains`, called from `hitPruneFn`. This object tests the shape, then runs the pick.
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

  /** Per-pointer records (hover, press paths), keyed by `pointerId` */
  private readonly _pointerRecords = new Map<number, PointerRecord3D>();

  /** Freed records, reused so steady pointer traffic allocates nothing */
  private readonly _recordPool: PointerRecord3D[] = [];

  /** Freed path arrays, reused for press and hover paths */
  private readonly _pathPool: Container3D[][] = [];

  /** Click counts keyed by `pointerId`; they outlive the pointer records */
  private readonly _clickHistories = new Map<number, ClickHistory3D>();

  /** Freed `ClickHistory3D` entries */
  private readonly _clickHistoryPool: ClickHistory3D[] = [];

  /**
   * `nativeEvent` and pick of the last `pointermove` this View dispatched
   *
   * `_dispatchGlobalMove` takes the 3D fields from these rather than from the event's own field
   * storage, which any View3D on the stage may have written last.
   */
  private _movePickToken: unknown = TOKEN_NONE;
  private _movePick3D: Container3D | null = null;

  /** The View's own cursor, shown over empty space; set through {@link View3D#cursor} */
  private _cursorFallback: Cursor | (string & {}) | undefined;

  /**
   * The hit behind `_currentPick3D`, from the last `_containsPoint` ray cast, copied into each
   * event dispatched for it
   *
   * `raycast` fills a new object instead, so calling it from a listener can't change what the
   * rest of that event's dispatches report.
   */
  private readonly _lastHit: RaycastHit3D = createRaycastHit3D();

  private readonly _scratchWorldRay = new Ray();
  private readonly _scratchGlobal = new Vector2();
  private readonly _scratchLocalRay = new Ray();
  private readonly _scratchNormalMatrix = new Matrix4();
  private readonly _scratchWorldPoint = new Vector3();
  private readonly _scratchCenter = new Vector3();
  private readonly _scratchHit: HitResult3D = createHitResult3D();
  /**
   * Scratch for the clip tests, apart from the pick loop's own
   *
   * The clip prefilter runs between a candidate's broadphase and its exact test, and the
   * containment test runs while `_scratchWorldPoint` holds the winner's hit point, so neither may
   * overwrite the pick loop's scratch.
   */
  private readonly _scratchClipRay = new Ray();
  private readonly _scratchClipPoint = new Vector3();

  /**
   * Makes the View hit-testable and adds the listeners that carry its events into the scene
   *
   * The View starts `'static'`; `_changeDynamicCount` makes it `'dynamic'` while any 3D node is,
   * so pixi's ticker picks again under a still pointer. The listeners are added here, before any
   * user code can add its own, so they run first among the View's plain listeners
   * (`eventemitter3` calls them in the order they were added) and fill in the 3D fields before
   * user listeners read them. Each type gets its own closure, as `POINTER_EVENT_TYPES` explains.
   * `wheel` goes straight to the current pick, which pixi's hit test has already found, with no
   * per-pointer tracking, as in 2D. `globalpointermove` reaches the View on every move over the
   * canvas, from pixi's `all()`, and is passed on to every interactive 3D node.
   * @param view - The View this boundary serves.
   */
  constructor(view: View3D) {
    this._view = view;

    view.eventMode = 'static';

    for (const type of POINTER_EVENT_TYPES) {
      view.on(type, (event: FederatedPointerEvent) => this._dispatch3DEvent(type, event));
    }
    view.on('wheel', (event: FederatedWheelEvent) => this._forwardToPick(event, 'wheel', this._currentPick3D));
    view.on('globalpointermove', (event: FederatedPointerEvent) => this._dispatchGlobalMove(event));
  }

  /**
   * Drops every `Container3D` this boundary holds: pointer records, click counts, the cached picks
   * and the pick list
   *
   * {@link View3D#destroy} calls it after detaching the scene's nodes. The View's root is never
   * detached, so it can still be on the pick list; every node left there gets its `_pickIndex`
   * reset, or it could never register with another View. The boundary owns no GPU or DOM
   * resources, and its listeners live on the View, whose own destroy removes them.
   * @internal
   */
  public destroy(): void {
    for (const [id, record] of this._pointerRecords) this._freePointerRecord(id, record);
    this._clickHistories.clear();
    this._clickHistoryPool.length = 0;
    this._recordPool.length = 0;
    this._pathPool.length = 0;
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
   * The body of {@link View3D#cursor}: the picked node's cursor, or the View's own when nothing is
   * picked or the node's cursor is `null`
   *
   * The pick is always fresh here, because pixi reads the cursor right after its hit test.
   * @returns The picked node's cursor, or the View's own when nothing is picked.
   */
  public get cursor(): Cursor | (string & {}) | undefined {
    return this._currentPick3D?.cursor ?? this._cursorFallback;
  }

  /**
   * Sets the View's own cursor, shown when nothing is picked
   * @param value - Cursor the View shows when no 3D node is picked.
   */
  public set cursor(value: Cursor | (string & {}) | undefined) {
    this._cursorFallback = value;
  }

  /**
   * The body of {@link View3D#containsPoint}
   *
   * Pixi calls it during its hit test with the point already mapped by
   * `worldTransform.applyInverse`, so `(x, y)` is in the View's local 2D space, where
   * `updateBounds` places the View. It casts the 3D ray and keeps the picked node in
   * `_currentPick3D`; over empty space the View itself is still the event target.
   *
   * It maps the point back to global space with the same `worldTransform` to build the ray, and
   * casts with `skipUpdate`, so the ray and the nodes it is tested against all use the transforms
   * from the last render, and the user picks what they see.
   *
   * The renderer-default warning is checked here rather than in the constructor, because the
   * renderer, which sets that default, is usually created after the scene, and always before the
   * first hit test.
   * @param x - View3D-local x.
   * @param y - View3D-local y.
   * @returns Whether the point falls inside the View's 2D rect.
   * @internal
   */
  public _containsPoint(x: number, y: number): boolean {
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

    const view = this._view;
    view.worldTransform.apply(this._scratchGlobal.set(x, y), this._scratchGlobal);
    view.screenToRay(this._scratchGlobal, this._scratchWorldRay, true);

    this._currentPick3D = this._pickWithWorldRay(this._scratchWorldRay, this._lastHit) ? this._lastHit.target : null;
    return true;
  }

  /**
   * Tests View3D-local `(x, y)` against the View's 2D rect
   *
   * `updateBounds` puts the View's left edge at `-anchor.x * width`, so adding `anchor * size`
   * moves the origin to the View's top-left corner.
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
   * The body of {@link View3D#raycast}, which documents what it does
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
   * Puts a node on the pick list, counting it if it is `'dynamic'`
   *
   * Called by the `eventMode`, `interactiveChildren` and `hitVolume` setters, their subtree
   * updates, and `View3D._attach`, for nodes under no barrier whose own mode is `'static'`,
   * `'dynamic'` or `'auto'`, or which are `'passive'` with a volume under an interactive ancestor.
   * Does nothing for a node already on the list: `_pickIndex`, which only this method and
   * `_removeInteractive` write, makes every call safe to repeat.
   * @param node - Node joining the pick list.
   * @internal
   */
  public _addInteractive(node: Container3D): void {
    if (node._pickIndex !== -1) return;
    node._pickIndex = this._interactiveList.push(node) - 1;
    if (node._eventMode === 'dynamic') this._changeDynamicCount(1);
  }

  /**
   * Takes a node off the pick list and clears any cached pick of it; the inverse of
   * `_addInteractive`
   *
   * The last entry moves into the freed slot, so a removal is O(1) however long the list is, and
   * removing a large subtree stays linear; that is why the order is unspecified. Called from the
   * same places as `_addInteractive`, and does nothing for a node not on the list.
   * @param node - Node leaving the pick list.
   * @param wasDynamic - Whether the node was `'dynamic'` when it was counted. The `eventMode` setter
   * passes it because the node's mode has already changed by then; other callers use the default,
   * the current mode.
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
   * Counts the `'dynamic'` nodes on the pick list and sets the View's own 2D `eventMode` to match
   *
   * While any 3D node is `'dynamic'`, the View is too, so pixi's `EventsTicker` sends pointer moves
   * under a still pointer and the scene is picked again. The View only switches between `'static'`
   * and `'dynamic'`; a `'none'` or `'passive'` you set on it stays.
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
   * Forgets `node` as the current pick when it stops taking part, because it was detached or made
   * non-interactive
   *
   * No `pointerout` is sent: events fired by a change to the scene would be surprising. The press
   * and hover paths in the pointer records stay as they are on purpose. They hold whole paths, so
   * a later release or hover change still reaches the deepest ancestor still in place through
   * `findMountedTarget3D`, as 2D does for removed targets.
   * @param node - Node leaving interaction.
   * @internal
   */
  public _clearPickState(node: Container3D): void {
    if (this._currentPick3D === node) this._currentPick3D = null;
    if (this._movePick3D === node) this._movePick3D = null;
  }

  /**
   * Finds the closest hit along a world-space ray among the nodes on the pick list
   *
   * It runs on every pointer event, so each node goes through the cheap checks first:
   *
   * 1. Its shape: the `hitVolume` if set, else the default, such as a mesh's bounding box. A plain
   *    container has none and is skipped, as a 2D `Container` without a `hitArea` is.
   * 2. Visibility: a node that is hidden, or under a hidden ancestor, neither hits nor blocks, as
   *    in 2D. `_worldVisible` comes from the last transform pass, like the matrices used below.
   * 3. Broadphase: the ray against a sphere around the node's world position that encloses its
   *    shape, all in squared distances, so a miss costs no matrix inverse and no ray transform.
   * 4. Clip prefilter, only while some node in the View has a `hitVolume`: a node can't hit inside
   *    a clipping ancestor the ray misses. `clipStamp` is new for each pick, or `0` while clipping
   *    is off, so each ancestor's ray test is shared by all its descendants.
   * 5. The exact test, in the node's local space.
   * 6. Distance, in world space. The local ray's direction is renormalised, so its `t` is in that
   *    node's local units; comparing those would sort nodes of different scale wrongly. Each hit
   *    point goes back to world space and the true distances are compared.
   * 7. The target, last, because it walks the ancestors: `_resolvePickTarget` applies barriers,
   *    passes a non-interactive hit to its interactive ancestor, and tests the hit point against
   *    clipping ancestors. A hit with no target is skipped and blocks nothing.
   *
   * The winner's surface data belongs to the node that was struck (`bestSurfaceNode`), which is
   * not the reported target for a non-interactive hit. Its normal goes to world space through the
   * inverse-transpose of that node's world matrix, which keeps it right under non-uniform scale;
   * `transpose` writes into scratch and leaves the cached inverse alone.
   * @param worldRay - The pick ray, in world space.
   * @param out - Hit to fill with the winner, `target` included, on success; untouched on a miss.
   * @returns Whether the ray hit anything.
   */
  private _pickWithWorldRay(worldRay: Ray, out: RaycastHit3D): boolean {
    const list = this._interactiveList;
    const ox = worldRay.origin.x;
    const oy = worldRay.origin.y;
    const oz = worldRay.origin.z;
    const clipStamp = this._clipVolumeCount > 0 ? ++_clipPickStamp : 0;

    let bestDistance = Infinity;
    let bestNode: Container3D | null = null;
    let bestSurfaceNode: Container3D | null = null;
    let bestHasSurface = false;

    for (let i = 0; i < list.length; i++) {
      const node = list[i];
      const volume = node._hitVolumeResolved ?? node._getDefaultHitVolume();
      if (!volume) continue;
      if (node._worldVisible === 0) continue;

      const wt = node.worldTransform.elements;
      this._scratchCenter.set(wt[12], wt[13], wt[14]);
      const radiusSq = hitVolumeBoundingRadiusSq(volume) * node._getWorldScaleSq();
      if (worldRay.distanceSqToPoint(this._scratchCenter) > radiusSq) continue;

      if (clipStamp !== 0 && !this._passesClipPrefilter(node, worldRay, clipStamp)) continue;

      worldRay.applyMatrix4(node._getInverseWorldTransform(), this._scratchLocalRay);

      const t = intersectRayHitVolume(this._scratchLocalRay, volume, this._scratchHit);
      if (t < 0) continue;

      this._scratchHit.point.applyAffineMatrix4(node.worldTransform, this._scratchWorldPoint);
      const dx = this._scratchWorldPoint.x - ox;
      const dy = this._scratchWorldPoint.y - oy;
      const dz = this._scratchWorldPoint.z - oz;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance >= bestDistance) continue;

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
   * Finds the event target a hit on `node` reports, applying the barriers above it
   *
   * Walks every ancestor. An `interactiveChildren: false` or `eventMode: 'none'` ancestor rules
   * the node out, as in 2D. For a non-interactive node (`'auto'`, or a `'passive'` node on the list
   * because of its volume), it also notes the nearest interactive ancestor. The barrier checks never
   * fail while the pick list is right, since a barrier takes its subtree off it. They stay because
   * they only run for a hit that beats the best so far, so they are cheap, and a bug in the pick
   * list then costs time instead of picking the wrong node.
   *
   * Given a `worldPoint`, the same walk applies clipping: the point must be inside every `hitVolume`
   * set above the node (`_clipContains`), or the hit has no target and is skipped without blocking.
   * Only the pick loop passes a point. The global-move fan-out passes none, since it doesn't
   * hit-test, so it never clips, like 2D's broadcast.
   * @param node - Node the ray struck.
   * @param worldPoint - World-space hit point to containment-test against clip ancestors, or `null`
   * to skip clipping.
   * @returns `node` itself when it is interactive, its nearest interactive ancestor when it is not,
   * or `null` when ruled out or clipped. A non-interactive node with no interactive ancestor gets
   * `null` too, since 2D only hit-tests such nodes under an interactive ancestor.
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
   * Whether the ray enters every clipping volume above `node`, the cheap first half of clipping
   *
   * Each ancestor with a `hitVolume` is ray-tested once per pick, in its own local space, and the
   * result is kept on it under `clipStamp` (`_clipRayStamp`, `_clipRayHit`), so a volume above many
   * descendants costs one test. If the ray misses any of them, no hit on `node` can be inside it.
   * `applyMatrix4` renormalises the local ray's direction, so `intersectSphereT`, which needs a
   * unit direction, works under any ancestor scale.
   *
   * Each shape is tested the way containment treats it: `Box` and `Sphere` exactly, a `Geometry3D`
   * by its `bounds3D` box, since containment uses the box too. An {@link IHitVolume3D} always
   * passes: it is only clipped by `containsPoint` on the winning hit, because its `raycast` may
   * miss from inside an unbounded volume.
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
   * Whether a world-space point is inside one ancestor's clipping volume
   *
   * The point goes into the ancestor's local space through its cached inverse world matrix. `Box`
   * and `Sphere` test exactly. A `Geometry3D` tests its `bounds3D` box: whether a point is inside an
   * open mesh isn't well defined, and testing every triangle would be too slow on mobile. An
   * {@link IHitVolume3D} clips through its optional `containsPoint`, and never without it. A
   * `hitVolume` that resolved to no shape doesn't clip either.
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
   * Carries one pointer event into the 3D scene; the View's first plain listener for every type in
   * `POINTER_EVENT_TYPES`
   *
   * It runs before any user `view.on(type, …)` listener, so it fills in the event's 3D fields and
   * dispatches along the picked node's 3D chain first. The View's `on*` handler and `*capture`
   * listeners run earlier still, in pixi's order, and read the fields as `null`.
   *
   * State is kept per pointer (`PointerRecord3D`): hover path, press path per button, click target.
   * Simultaneous touches, and simultaneous buttons of one mouse, never disturb each other. A record
   * is freed on the final release outside the View, on `pointerout` with no button held, or once
   * stale. Click counts live outside the records (`ClickHistory3D`), so they outlast them, as 2D's
   * do.
   *
   * By type:
   *
   * - `pointerout`: the pointer left the View, for another 2D element or off the canvas. Pixi won't
   *   hit-test this View for it again, so the hover check on moves can't see the change, and the
   *   hover is cleared here, in 2D's `mapPointerOut` order: `pointerout` bubbles from the hovered
   *   node, then each node up to the root gets `pointerleave`, with the mouse aliases for mouse and
   *   pen. A held button keeps the record, so a later `*upoutside` still finds the pressed node.
   * - `pointerover`: the pointer entered the View, onto the canvas or from another 2D element,
   *   always right after a fresh hit test. The hover is set now, in 2D's `mapPointerOver` order
   *   (`pointerover` bubbling, then `pointerenter` up to the root), rather than on the first move.
   * - `pointerdown`: stores the press path for the button, replacing one already held, as 2D does.
   *   A press on empty space stores an empty path, so the release still knows a press happened. A
   *   new press also drops the click target left by the last release.
   * - `pointermove`: notes this move's pick for the global-move fan-out (`_movePickToken`), which
   *   must never trust fields another View wrote on the shared event. Then it compares the hover
   *   with the pointer's record, since pixi's own comparison only sees 2D nodes. The stored path goes
   *   through `findMountedTarget3D`, so a hovered node removed from the scene hands over to its
   *   nearest ancestor still in place, as in 2D. On a change, the order is 2D's: `pointerout`,
   *   `pointerleave`, `pointerover`, `pointerenter`, each with its mouse alias for mouse and pen.
   *   Leave only runs when the pointer fully left the old node, not when it moved onto one of its
   *   descendants. Enter runs unless the new node is an ancestor of the old one, like 2D's
   *   `didPointerEnter` check. `target3D` is set to the node each pair is about, while `hit3D` stays
   *   the new pick.
   * - `pointerup`: sends `pointerup` along the release chain, then settles the press with
   *   `_reconcileRelease`. The chain is captured before any listener runs, like the `composedPath()`
   *   2D caches, so a listener that changes the scene can't change which nodes count as released
   *   over, for the upoutside walk or the click target.
   * - `pointerupoutside`: pixi found the release outside the View, on another 2D element or off the
   *   canvas, so no hit test ran and there is no pick: no `pointerup` and no click, only the
   *   upoutside walk, up to the root since there is no release chain to stop at, as in 2D.
   * - `mouseupoutside`, `rightupoutside`, `touchendoutside`: ignored. The upoutside walk already
   *   told each node with its alias, in 2D's per-node order.
   * - `click`, `rightclick`, `tap`, `pointertap`: sent to the click target the release worked out,
   *   the nearest common ancestor of press and release, not to whatever is under the pointer, so a
   *   press that slides off a node doesn't click the node it ends on. The stored target only applies
   *   when its token is this event's `nativeEvent`, which pixi's click shares with its `pointerup`.
   *   `hit3D` stays the release pick, even when the click goes to an ancestor or the View. `detail`
   *   is swapped for the 3D target's own count during the chain, because pixi counted clicks on the
   *   View. A click that resolved to the View runs no 3D chain, and the View's listeners see
   *   `target3D` as `null`. A click with no tracked press goes to the current pick.
   * - The other aliases (`mousedown`, `touchmove`, `mouseup`, …): the primary event already updated
   *   the state, so they only run their chain at the current pick.
   * - `contextmenu`: tied to no press or hover, so it goes to whatever the pointer is over now.
   *
   * A listener that stops propagation in a main chain also silences the View's own listeners
   * (`_stopViewPropagation`). For `pointerout` and `pointerover` only the primary chain counts, not
   * the mouse alias or the enter and leave walks, as in 2D.
   *
   * Pixi never delivers `pointercancel`. A cancelled pointer's record is freed by `pointerout`, by
   * the next press with the same id, or by the stale-record sweep for browsers that never reuse
   * ids.
   * @param type - Emitter key the dispatch arrived under, which for pixi's alias dispatches differs
   * from `event.type`.
   * @param event - The live pooled federated event.
   */
  private _dispatch3DEvent(type: Forwarded3DPointerType, event: FederatedPointerEvent): void {
    switch (type) {
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
        if (stopped) this._stopViewPropagation(event);
        return;
      }

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
        if (stopped) this._stopViewPropagation(event);
        return;
      }

      case 'pointerdown': {
        const pick = this._currentPick3D;
        const record = this._getPointerRecord(event.pointerId, event.timeStamp);
        const button = event.button ?? 0;
        const prevPath = record.pressPathByButton[button];
        if (prevPath) this._releasePath(prevPath);
        else record.heldPressCount++;
        record.pressPathByButton[button] = pick ? this._capturePath(pick) : this._acquirePath();
        record.clickToken = TOKEN_NONE;
        this._forwardToPick(event, type, pick);
        return;
      }

      case 'pointermove': {
        const pick = this._currentPick3D;
        this._movePickToken = event.nativeEvent;
        this._movePick3D = pick;
        let record = this._pointerRecords.get(event.pointerId);
        if (!record && pick) record = this._getPointerRecord(event.pointerId, event.timeStamp);
        if (record) {
          record.lastEventTime = event.timeStamp;
          const prev = record.overPath ? findMountedTarget3D(record.overPath) : null;
          if (prev !== pick) {
            const isMouse = event.pointerType === 'mouse' || event.pointerType === 'pen';
            if (prev) {
              this._writeFields(event, prev, pick);
              this._emit3DChain(event, 'pointerout', prev);
              if (isMouse) this._emit3DChain(event, 'mouseout', prev);
              if (!this._isInChain(prev, pick)) this._emitEnterLeaveWalk(event, prev, pick, false, isMouse);
            }
            if (pick) {
              this._writeFields(event, pick, pick);
              this._emit3DChain(event, 'pointerover', pick);
              if (isMouse) this._emit3DChain(event, 'mouseover', pick);
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

      case 'pointerupoutside':
        this._writeFields(event, null, null);
        this._reconcileRelease(event, null, false);
        return;

      case 'mouseupoutside':
      case 'rightupoutside':
      case 'touchendoutside':
        return;

      case 'click':
      case 'rightclick':
      case 'tap':
      case 'pointertap': {
        const record = this._pointerRecords.get(event.pointerId);
        if (record && record.clickToken === event.nativeEvent) {
          const target = record.clickTarget3D;
          this._writeFields(event, target, this._currentPick3D);
          if (!target) {
            return;
          }
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
        this._forwardToPick(event, type, this._currentPick3D);
        return;
      }

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

      case 'contextmenu':
        this._forwardToPick(event, type, this._currentPick3D);
        return;
    }
  }

  /**
   * Writes the event's 3D fields for `pick` and, on a hit, runs the event along the picked node's
   * 3D chain
   *
   * If a 3D listener stopped the chain, the View's own listeners are silenced too
   * (`_stopViewPropagation`). On a miss the fields are still written, so the View's own listeners,
   * such as a "click on empty space" handler, read `target3D` as `null` rather than a value left
   * on the reused event.
   * @param event - The live pooled federated event.
   * @param type - Emitter key to dispatch under.
   * @param pick - Node to dispatch at, or `null` for a viewport miss.
   */
  private _forwardToPick(event: FederatedMouseEvent, type: Chained3DType, pick: Container3D | null): void {
    this._writeFields(event, pick, pick);
    if (pick && this._emit3DChain(event, type, pick)) this._stopViewPropagation(event);
  }

  /**
   * Settles the press when a pointer is released, as the end of 2D's `mapPointerUp` and
   * `mapPointerUpOutside` does
   *
   * Takes the press path stored for the released button. When the pressed node, or its nearest
   * ancestor still in place, isn't on the release chain, it runs the upoutside walk. The click
   * target is the nearest common ancestor of press and release: the pressed node itself when the
   * release landed on it or inside it, and `null`, meaning the View, which is an ancestor of every
   * 3D node, when there is none. A press on empty space always ends there, so no 3D node gets that
   * click. For a release inside the View, it stores the click target and its count for the click
   * events that follow.
   *
   * Membership is tested against the release chain captured before `pointerup` ran, never against
   * live parents: 2D tests against the release event's cached `composedPath()`, so a `pointerup`
   * listener that changes the scene can't cause stray upoutside events or move the click target.
   *
   * It runs during the `pointerup` dispatch, so the `mouseup` and `touchend` chains arrive after
   * the upoutside walk; 2D sends them before it.
   *
   * After the last button is released outside the View, the record is freed at once: nothing can
   * use it again, since 2D sends no click after an outside release. A release inside the View
   * keeps it, because the pointer is still over the View and the click is about to read it;
   * `pointerout` frees it later.
   * @param event - The release event.
   * @param releasePath - Release chain frozen before the `pointerup` chain dispatched (root-first,
   * `[root3D, …, releasePick]`), or `null` when the release didn't hit a 3D node: empty viewport, or
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

    let clickTarget = pressTarget;
    if (pressTarget && (releasePath === null || !releasePath.includes(pressTarget))) {
      clickTarget = this._emitUpOutsideWalk(event, pressTarget, releasePath);
    }

    if (insideView) {
      record.clickTarget3D = clickTarget;
      record.clickDetail = clickTarget ? this._countClick(event.pointerId, button, clickTarget) : 0;
      record.clickToken = event.nativeEvent;
    } else if (record.heldPressCount === 0) {
      this._freePointerRecord(event.pointerId, record);
    }
  }

  /**
   * Sends `pointerupoutside` from `pressTarget` up to, not including, the first ancestor on the
   * release chain
   *
   * Each node gets the alias for the pointer type right after, as in 2D. Only interactive nodes
   * are told, like 2D's `notifyTarget`. There is no capture pass: each node is told directly in the
   * bubble phase, its handler property first, then its listeners. A propagation stop is never
   * checked between nodes, but an immediate stop silences the rest of each node's listener list
   * through `notifyListeners3D`, both as in 2D. `target3D` names the pressed node during the walk
   * and is restored after; `hit3D` stays the release pick, what the pointer was released over.
   *
   * The walk's target is the pressed node, not the end of a chain, so `composedPath()` is worked
   * out fresh on each call, as in 2D. `event.path` is saved and restored only so it doesn't keep a
   * 3D array after the walk.
   * @param event - The release event.
   * @param pressTarget - Deepest still-mounted node of the stored press path.
   * @param releasePath - Frozen release chain, or `null` when the release didn't hit a 3D node.
   * @returns The first ancestor on the release path, which is the click target, or `null` when the
   * walk reaches the root, meaning the click belongs to the View.
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
   * Counts repeat clicks, as 2D does
   *
   * A click on the same 3D target within `MULTI_CLICK_INTERVAL_MS` raises the count; anything else
   * resets it to 1. There is no distance limit, in 2D either. Counts are kept by `pointerId` on the
   * boundary, not on the pointer record, so they outlast it: a tap's `pointerout` frees the record,
   * and the tap after it must still count 2.
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
   * Frees click counts older than `MULTI_CLICK_INTERVAL_MS`
   *
   * They can't raise any count, so dropping them changes nothing. It only runs when a new pointer's
   * entry is made, so browsers that give each touch a new `pointerId` don't keep one entry per tap.
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
   * Silences the View's own listeners after a 3D listener stopped a main chain
   *
   * The View is an ancestor of every 3D node, so it has to go quiet too. But pixi only checks
   * `propagationStopped` between 2D targets, and the View's own listeners are in the same listener
   * list as this dispatcher, so `propagationImmediatelyStopped` is set as well, which makes pixi
   * skip the rest of that list. That silences every listener on the View for this event; none can
   * be exempted.
   * @param event - Event to mark as stopped.
   */
  private _stopViewPropagation(event: FederatedMouseEvent): void {
    event.propagationStopped = true;
    event.propagationImmediatelyStopped = true;
  }

  /**
   * Returns the record for `pointerId`, taking one from the pool or making one when there is none
   *
   * A new pointer is also when stale records are swept: on browsers that never reuse touch ids, a
   * cancelled touch's record can only be freed here, since pixi never delivers `pointercancel`.
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

  private _acquirePath(): Container3D[] {
    return this._pathPool.pop() ?? [];
  }

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
   * Writes the event's 3D fields for a dispatch, with the token that makes them readable
   * @param event - Event to write into.
   * @param target - Node to report as `target3D`: the dispatch target, or `null` when the event
   * belongs to the View itself.
   * @param pick - The View's pick for this event, the node `_lastHit` describes, reported as
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
   * Dispatches `type` along `from`'s 3D chain in three phases, as 2D's `propagate` does
   *
   * Capture runs from the root to the target's parent under the `'${type}capture'` key, then the
   * target gets both keys, then bubble runs back up under the plain key. `event.eventPhase` is set
   * throughout, and a propagation stop is honoured between nodes. Each node is handled as in 2D's
   * `notifyTarget`: non-interactive nodes are passed over silently, and a node's handler property
   * runs before its listeners in every phase, so an ancestor's handler runs in both the capture and
   * bubble passes. Listeners go through `notifyListeners3D`, so an immediate stop is honoured
   * between a node's own listeners, including between the capture and plain lists at the target,
   * with 2D's single-listener exception. An unused capture pass costs one property read and one map
   * lookup per ancestor.
   *
   * The chain is copied into a pooled root-first array before any listener runs, so moving nodes
   * mid-dispatch can't break the walk, like the `composedPath` 2D caches. The copy is set as
   * `event.path` for the walk, so a listener's `composedPath()` returns that exact chain instead of
   * pixi working it out again from live parents, which would allocate and see any moves.
   *
   * During the walk, `event.target`, `currentTarget`, `type` and `eventPhase` hold 3D values, and
   * they are restored after, so pixi's own 2D dispatch carries on undisturbed. `currentTarget3D`
   * follows `currentTarget`, which is typed as a 2D `Container`, so the 3D storage holds the typed
   * node. The propagation flags are cleared at the start, since each call is its own dispatch (a
   * `pointerover` sent on a move doesn't depend on that `pointermove`), and restored at the end,
   * so a stop inside a sent chain can't leak into the 2D dispatch around it.
   * @param event - The live pooled federated event.
   * @param type - Emitter key to dispatch under.
   * @param from - Node at the end of the chain, the dispatch target.
   * @param frozenPath - Chain captured by the caller, who keeps and frees it. The release shares
   * one captured chain between its dispatch and `_reconcileRelease`.
   * @returns Whether a listener stopped the chain. Callers dispatching the *main* event apply
   * `_stopViewPropagation` with it; chains they send of their own ignore it.
   */
  private _emit3DChain(
    event: FederatedMouseEvent,
    type: Chained3DType,
    from: Container3D,
    frozenPath?: Container3D[] | null,
  ): boolean {
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
   * Sends `pointerenter` or `pointerleave`, which don't bubble, to each node from `from` upwards;
   * shared by the hover check on moves, entering the View and leaving it
   *
   * For mouse and pen, each node gets `mouseenter` or `mouseleave` right after, as in 2D. The walk
   * goes up from `from`:
   *
   * - enter: up to, not including, `boundary` (the old hover target), or to the root when
   *   `boundary` is `null` (first hover, or entering the View).
   * - leave: up to, not including, the first ancestor on `boundary`'s chain (the node the pointer is
   *   still over), or to the root when `boundary` is `null` (the pointer left the View).
   *
   * Only interactive nodes are told, like 2D's `notifyTarget`. Each is told as its own target in
   * the `AT_TARGET` phase, so its `*capture` listeners run with the plain ones, after its handler
   * property, as in 2D. A propagation stop is never checked between nodes, but an immediate stop
   * silences the rest of each node's listener list through `notifyListeners3D`, both as in 2D.
   * The event's dispatch state, including `target3D`, which follows the node being told, is
   * restored after.
   *
   * Each node is its own target, so there is no fixed chain, and `composedPath()` is worked out
   * fresh for each node, as in 2D. `event.path` is saved and restored only so it doesn't keep a 3D
   * array after the walk.
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
   * Sends `globalpointermove` and its alias for the pointer type to every interactive node, on
   * each global move pixi sends the View
   *
   * Every interactive node in the list, skipping `'auto'` and `'passive'` entries and nodes that
   * are hidden or under a barrier, is told once per type, directly, with no chain. The phase is
   * set to `BUBBLING_PHASE`, so capture listeners never get global moves, as in 2D, and each node's
   * handler property runs before its listeners. 2D tells interactive ancestors of the hit target
   * twice, because its `hitTestMoveRecursive` collects them twice; here each node hears it once.
   * A node with no global-move listener or handler is skipped before any other check, and that
   * can't be seen from outside, since the skipped checks only decide whether its missing listeners
   * would run. So with nothing listening, the usual case, the fan-out costs a few property reads
   * per node rather than an ancestor walk (`_resolvePickTarget`) each.
   *
   * The 3D fields are written once for the whole fan-out, from this View's own note of the move
   * (`_movePickToken`, `_movePick3D`). Every View3D on the stage shares the event object and its
   * field storage, so a matching token alone could be another View's write, with world-space data
   * from another camera. When the move didn't go through this View there is no ray, and the fields
   * read `null`. `event.target` is left alone, as 2D's `all()` keeps its 2D hit target; the 3D pick,
   * if any, is on `target3D`.
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
