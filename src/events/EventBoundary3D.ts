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
 * Each type gets its own listener: pixi fires alias events (`mousedown`, `tap`, …) with `event.type`
 * still the primary name, so only the emitter key says which one arrived
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

type Forwarded3DPointerType = (typeof POINTER_EVENT_TYPES)[number];

/** The repeat-click window 2D's `EventBoundary` hard-codes */
const MULTI_CLICK_INTERVAL_MS = 200;

/**
 * Frees a cancelled touch's record on browsers that never reuse a `pointerId`, since pixi sends no
 * `pointercancel`; long enough that a press held still survives
 */
const POINTER_RECORD_STALE_MS = 60_000;

type Chained3DType = Exclude<Forwarded3DPointerType, `${string}outside`> | 'mouseover' | 'mouseout' | 'wheel';

/** Emitter and handler-property keys per `Chained3DType`, built once so dispatch never concatenates strings */
const CHAIN_KEYS: Record<Chained3DType, { onKey: string; captureKey: string }> = Object.create(null);
for (const type of [...POINTER_EVENT_TYPES, 'mouseover', 'mouseout', 'wheel'] as const) {
  if (type.endsWith('outside')) continue;
  CHAIN_KEYS[type as Chained3DType] = { onKey: 'on' + type, captureKey: type + 'capture' };
}

/**
 * `eventemitter3`'s internal listener shape, read directly as 2D does, since `emit` can't stop between
 * listeners for `stopImmediatePropagation`
 */
interface EmitterListener {
  fn: (event: FederatedMouseEvent) => void;
  context: unknown;
  once: boolean;
}

interface EmitterInternal {
  _events: Record<string, EmitterListener | EmitterListener[] | undefined>;
}

type WritableTypeEvent = FederatedMouseEvent & { type: string };

/**
 * A port of 2D's `EventBoundary._notifyListeners`, quirk included: a lone listener runs even after
 * `stopImmediatePropagation`
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

/** Numbers picks for each node's `_clipRayStamp`; shared by every View, so a moved node's stamp can't match */
let _clipPickStamp = 0;

const CAPTURING_PHASE = 1;
const AT_TARGET = 2;
const BUBBLING_PHASE = 3;

function onHandlerOf(
  node: Container3D,
  onKey: string,
): ((this: Container3D, event: FederatedMouseEvent) => void) | null | undefined {
  return (
    node as unknown as Record<string, ((this: Container3D, event: FederatedMouseEvent) => void) | null | undefined>
  )[onKey];
}

let _warnedDefaultEventMode = false;
GlobalResourceRegistry.register({
  clear: () => {
    _warnedDefaultEventMode = false;
  },
});

interface Click3DHistory {
  clickCount: number;
  target: Container3D | null;
  timeStamp: number;
}

/** Kept apart from the pointer records, which a tap's `pointerout` frees before the next tap counts */
interface ClickHistory3D {
  byButton: (Click3DHistory | null)[];
  lastClickTime: number;
}

/**
 * Paths are root-first and stored whole, so `findMountedTarget3D` can fall back to the nearest node
 * still mounted after a removal, as 2D's `TrackingData` does
 */
interface PointerRecord3D {
  /** `null` while the button is up; an empty path is a press on empty space */
  pressPathByButton: (Container3D[] | null)[];
  /** Count of non-`null` entries in `pressPathByButton` */
  heldPressCount: number;
  overPath: Container3D[] | null;
  lastEventTime: number;
  /** `null` means the click belongs to the View */
  clickTarget3D: Container3D | null;
  clickDetail: number;
  /** The release's `nativeEvent`, which pixi's click events share with their `pointerup` */
  clickToken: unknown;
}

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
 * Each View makes one, at `view3d.events`. It sends each pointer event the View gets on to the 3D
 * node under the pointer and its ancestors, with capture, target and bubble phases as in 2D.
 *
 * You rarely need it directly: set {@link IFederatedContainer3D#eventMode | eventMode} on nodes
 * and listen on them. It holds the settings that apply to the whole View.
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
   * Every node a pick tests, in no order; each node's `_pickIndex` is its slot
   * @internal
   */
  public _interactiveList: Container3D[] = [];

  /**
   * Whether interactive 3D nodes hear `globalpointermove` on every pointer move on the page
   *
   * The usual tool for a drag that keeps tracking after the pointer leaves the object;
   * `globalmousemove` and `globaltouchmove` come with it. It also needs the renderer's
   * `eventFeatures.globalMove` option on, as 2D's global moves do.
   * @remarks
   * - Each interactive, visible node hears each move once, in no particular order.
   * - It costs a little time per node that takes part in picking on every move; turn it off in
   *   crowded scenes that don't use it.
   * @default true
   */
  public enableGlobalMoveEvents = true;

  private _dynamicPickCount = 0;

  /**
   * Attached nodes whose `_hitVolumeInput` isn't `null`; picks skip clipping while it is 0
   * @internal
   */
  public _clipVolumeCount = 0;

  /**
   * Target of pixi's last hit test on the View; one slot is enough, since pixi hit-tests right before
   * each dispatch and cursor read
   * @internal
   */
  public _currentPick3D: Container3D | null = null;

  /** @internal */
  public _hitAreaShape: IHitArea | null = null;

  /**
   * Runs the pick from `hitArea.contains`, because pixi's `hitTestFn` never calls `containsPoint` on a
   * container with a `hitArea`
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

  private readonly _pointerRecords = new Map<number, PointerRecord3D>();

  /** With `_pathPool`, reused so steady pointer traffic allocates nothing */
  private readonly _recordPool: PointerRecord3D[] = [];

  private readonly _pathPool: Container3D[][] = [];

  private readonly _clickHistories = new Map<number, ClickHistory3D>();

  private readonly _clickHistoryPool: ClickHistory3D[] = [];

  /** This View's own note of the last move's pick, since every View3D writes the same event's 3D fields */
  private _movePickToken: unknown = TOKEN_NONE;
  private _movePick3D: Container3D | null = null;

  private _cursorFallback: Cursor | (string & {}) | undefined;

  /** The hit behind `_currentPick3D`; `_raycast` never writes it, so a listener's call can't change `hit3D` */
  private readonly _lastHit: RaycastHit3D = createRaycastHit3D();

  /** Handed to the caller on a hit and replaced, so a miss allocates nothing and it never holds a node */
  private _raycastHit: RaycastHit3D = createRaycastHit3D();

  private readonly _scratchWorldRay = new Ray();
  private readonly _scratchGlobal = new Vector2();
  private readonly _scratchLocalRay = new Ray();
  private readonly _scratchNormalMatrix = new Matrix4();
  private readonly _scratchWorldPoint = new Vector3();
  private readonly _scratchHit: HitResult3D = createHitResult3D();
  /** Apart from the pick loop's scratch, which holds live values while the clip tests run */
  private readonly _scratchClipRay = new Ray();
  private readonly _scratchClipPoint = new Vector3();

  /**
   * Each {@link View3D} makes its own, before you can add listeners, so the View's plain
   * `view3d.on(type, …)` listeners see the 3D fields; {@link Event3DFields} covers the rest
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
   * Resets `_pickIndex` on nodes still listed, such as the root, which `View3D.destroy` never
   * detaches; the View's own destroy removes the listeners the constructor adds
   * @internal
   */
  public destroy(): void {
    for (const [id, record] of this._pointerRecords) this._freePointerRecord(id, record);
    (this._clickHistories as Map<number, ClickHistory3D> | null) = null;
    (this._clickHistoryPool as ClickHistory3D[] | null) = null;
    (this._recordPool as PointerRecord3D[] | null) = null;
    (this._pathPool as Container3D[][] | null) = null;
    const list = this._interactiveList;
    for (let i = 0; i < list.length; i++) list[i]._pickIndex = -1;
    list.length = 0;
    this._currentPick3D = null;
    this._hitAreaShape = null;
    this._movePick3D = null;
    this._movePickToken = TOKEN_NONE;
    this._clipVolumeCount = 0;
  }

  /** @internal */
  public get _cursor(): Cursor | (string & {}) | undefined {
    return this._currentPick3D?.cursor ?? this._cursorFallback;
  }

  /** @internal */
  public set _cursor(value: Cursor | (string & {}) | undefined) {
    this._cursorFallback = value;
  }

  /**
   * Picks with the last render's transforms, so users pick what they see; checks the renderer
   * default here, not in the constructor, because the renderer usually comes after the scene
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

  /** Must match the rect `View3D.updateBounds` gives the View */
  private _inViewRect(x: number, y: number): boolean {
    const view = this._view;
    const width = view.width;
    const height = view.height;
    const nx = (x + view.anchor.x * width) / width;
    const ny = (y + view.anchor.y * height) / height;
    return nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
  }

  /** @internal */
  public _raycast(position: PointData, out?: RaycastHit3D): RaycastHit3D | null {
    const view = this._view;
    const local = view.worldTransform.applyInverse(position, this._scratchGlobal);
    if (!this._inViewRect(local.x, local.y)) return null;

    view.screenToRay(position, this._scratchWorldRay, true);
    const hit = out ?? this._raycastHit;
    if (!this._pickWithWorldRay(this._scratchWorldRay, hit)) return null;
    if (!out) this._raycastHit = createRaycastHit3D();
    return hit;
  }

  /**
   * Does nothing for a node already listed, so callers needn't check
   * @internal
   */
  public _addInteractive(node: Container3D): void {
    if (node._pickIndex !== -1) return;
    node._pickIndex = this._interactiveList.push(node) - 1;
    if (node._eventMode === 'dynamic') this._changeDynamicCount(1);
  }

  /**
   * Does nothing for a node not listed
   * @param node - Node to remove.
   * @param wasDynamic - Pass it when the node's mode has changed since it was added.
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
   * Makes the View `'dynamic'` while any listed node is, so pixi's ticker picks again under a still
   * pointer; a `'none'` or `'passive'` set on the View stays
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

  /** @internal */
  public _clearPickState(node: Container3D): void {
    if (this._currentPick3D === node) this._currentPick3D = null;
    if (this._movePick3D === node) this._movePick3D = null;
  }

  /**
   * Compares hits by world distance, since each node's local `t` is in its own units; the ancestor
   * walk runs last, only for a hit that beats the best so far. The bounds test inlines
   * `Ray#distanceSqToPoint`, as it runs for every listed node
   */
  private _pickWithWorldRay(worldRay: Ray, out: RaycastHit3D): boolean {
    const list = this._interactiveList;
    const ox = worldRay.origin.x;
    const oy = worldRay.origin.y;
    const oz = worldRay.origin.z;
    const dirX = worldRay.direction.x;
    const dirY = worldRay.direction.y;
    const dirZ = worldRay.direction.z;
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
      const cx = wt[12] - ox;
      const cy = wt[13] - oy;
      const cz = wt[14] - oz;
      const along = Math.max(cx * dirX + cy * dirY + cz * dirZ, 0);
      const px = cx - dirX * along;
      const py = cy - dirY * along;
      const pz = cz - dirZ * along;
      if (px * px + py * py + pz * pz > hitVolumeBoundingRadiusSq(volume) * node._getWorldScaleSq()) continue;

      if (clipStamp !== 0 && !this._passesClipPrefilter(node, worldRay, clipStamp)) continue;

      const localPerWorld = this._toLocalRay(worldRay, node._getInverseWorldTransform());
      const t = intersectRayHitVolume(this._scratchLocalRay, volume, this._scratchHit, bestDistance * localPerWorld);
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

  /** As `Ray#applyMatrix4` into `_scratchLocalRay`, returning the local length of one world unit along the ray */
  private _toLocalRay(worldRay: Ray, inverse: Matrix4): number {
    const local = this._scratchLocalRay;
    worldRay.origin.applyAffineMatrix4(inverse, local.origin);
    const d = worldRay.direction;
    const e = inverse.elements;
    const x = e[0] * d.x + e[4] * d.y + e[8] * d.z;
    const y = e[1] * d.x + e[5] * d.y + e[9] * d.z;
    const z = e[2] * d.x + e[6] * d.y + e[10] * d.z;
    const length = Math.sqrt(x * x + y * y + z * z) || 1;
    const scale = 1 / length;
    local.direction.x = x * scale;
    local.direction.y = y * scale;
    local.direction.z = z * scale;
    return length;
  }

  /**
   * Repeats `getAncestorPickState`'s barrier rule, so a pick-list bug costs time rather than a wrong
   * target, and clips against ancestors' volumes when given `worldPoint`
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
   * Must treat each shape as `_clipContains` does; an `IHitVolume3D` passes, since its `raycast` can
   * miss from inside it
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

  /** Must treat each shape as `_passesClipPrefilter` does */
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
   * `mouseupoutside`, `rightupoutside` and `touchendoutside` do nothing here: `_emitUpOutsideWalk`
   * already sent them, node by node
   * @param type - Emitter key, which for an alias differs from `event.type`.
   * @param event - The event.
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

  /** Writes the 3D fields even on a miss, so the View's listeners never read ones an earlier dispatch left */
  private _forwardToPick(event: FederatedMouseEvent, type: Chained3DType, pick: Container3D | null): void {
    this._writeFields(event, pick, pick);
    if (pick && this._emit3DChain(event, type, pick)) this._stopViewPropagation(event);
  }

  /**
   * Tests against the release chain captured before `pointerup` ran, as 2D tests its cached
   * `composedPath()`, so a listener that moves nodes can't change the outcome
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
   * Matches 2D's upoutside walk: interactive nodes only, no capture pass, and no stop between nodes
   * @returns The first ancestor on the release chain, the click target, or `null` for the View.
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

  private _isInChain(node: Container3D, chainTail: Container3D | null): boolean {
    let cur = chainTail;
    while (cur) {
      if (cur === node) return true;
      cur = cur.parent;
    }
    return false;
  }

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
   * Sets `propagationImmediatelyStopped` too: the View's own listeners share a list with this
   * dispatcher, and pixi only checks `propagationStopped` between targets
   */
  private _stopViewPropagation(event: FederatedMouseEvent): void {
    event.propagationStopped = true;
    event.propagationImmediatelyStopped = true;
  }

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

  private _sweepStaleRecords(now: number): void {
    for (const [id, record] of this._pointerRecords) {
      if (now - record.lastEventTime >= POINTER_RECORD_STALE_MS) this._freePointerRecord(id, record);
    }
  }

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

  /** The token is `event.nativeEvent`, which the `Event3DFields` getters in `Pointer3DEvent.ts` check */
  private _writeFields(event: FederatedMouseEvent, target: Container3D | null, pick: Container3D | null): void {
    const s = ensurePick3D(event);
    if (pick !== null) copyRaycastHit3D(this._lastHit, s.hit);
    s.hasHit = pick !== null;
    s.target = target;
    s.token = event.nativeEvent;
  }

  /**
   * Mirrors 2D's `propagate` with `event.path` set to the frozen chain, so `composedPath()` neither
   * allocates nor sees moves; restores the event's dispatch state after, for pixi's own dispatch
   * @param event - The event.
   * @param type - Emitter key.
   * @param from - The dispatch target.
   * @param frozenPath - A chain the caller captured and frees itself.
   * @returns Whether a listener stopped the chain.
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

  /** Mirrors 2D's enter and leave walks: each interactive node is told as its own target, `*capture` listeners included */
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

  /** Skips a node with no global-move listener first, so the fan-out stays cheap when nothing listens */
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
