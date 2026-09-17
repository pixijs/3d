import type { Cursor, EventMode } from 'pixi.js';

import { Matrix4 } from '../math/matrix/Matrix4';
import type { Container3D } from '../scene/Container3D';
import type { EventBoundary3D } from './EventBoundary3D';
import type { FederatedEventEmitterTypes3D } from './FederatedEventMap3D';
import type { HitVolume3D, HitVolume3DInput } from './HitResult3D';
import type { Pointer3DEventHandler, Wheel3DEventHandler } from './Pointer3DEvent';
import { resolveHitVolume } from './resolveHitVolume';

/**
 * The interactive members mixed into every {@link Container3D}
 *
 * The 3D counterpart of pixi.js's `IFederatedContainer`. Implemented by `FederatedContainer3D`
 * and applied to `Container3D.prototype` with `extensions.mixin`, exactly as 2D applies
 * `FederatedContainer` to `Container`.
 *
 * State-backing members live on the prototype with inert defaults (`null` / `undefined`), so a node
 * that never opts into interaction carries no per-instance storage; the first write shadows the
 * default with an own property.
 * @example
 * ```ts
 * mesh.eventMode = 'static'; // pickable, and fires listeners
 * mesh.cursor = 'pointer';
 * mesh.on('pointertap', (e) => {
 *   if (e.hit3D) spawnDecal(e.hit3D.point, e.hit3D.normal);
 * });
 *
 * // Or the property form, no emitter involved
 * mesh.onpointerenter = () => mesh.scale.set(1.1);
 * mesh.onpointerleave = () => mesh.scale.set(1);
 * ```
 * @remarks
 * - A set on-handler runs before that node's emitter listeners at every propagation phase, so an
 *   ancestor's handler fires in both the capture and the bubble pass. A 2D quirk, kept for parity.
 * - `Pointer3DEvent` payloads are pooled and reused; see {@link Event3DFields} before holding on to one.
 * @see {@link View3D#raycast} For a one-off pick that needs no listeners.
 * @category events
 * @standard
 */
export interface IFederatedContainer3D {
  /**
   * Backing store for {@link IFederatedContainer3D#eventMode | eventMode} — `undefined`
   * until first set, read as `'passive'`. Public so the picker's hot loop (ancestor prune) reads the
   * field directly instead of going through the accessor.
   * @internal
   */
  _eventMode?: EventMode;

  /**
   * How this node takes part in 3D picking
   *
   * Mirrors pixi 2D's `Container.eventMode`.
   *
   * Available modes:
   *
   * - `'none'`: never picked, and a barrier for the whole subtree: every descendant is unregistered
   *   from the View's pick list — not merely skipped, so a dead subtree costs nothing per pointer
   *   event. The full opt-out.
   * - `'passive'`: **(default)** never the event target and fires no listeners of its own, but while
   *   an interactive ancestor exists the node is still ray-tested and a hit reports that ancestor as
   *   the target, carrying this node's surface data — as in 2D. So making a group `'static'` makes its
   *   whole subtree clickable with the group as target, no per-child setup.
   * - `'auto'`: behaves exactly like `'passive'` at pick time — ray-tested on behalf of the nearest
   *   interactive ancestor, never the target itself, no listeners. Kept for 2D parity; the default
   *   already gives the "click anywhere on this group" pattern.
   * - `'static'`: picked against its {@link IFederatedContainer3D#hitVolume | hitVolume} (a `Mesh3D`
   *   defaults to its live geometry AABB) and fires listeners.
   * - `'dynamic'`: as `'static'`, and the owning {@link View3D} upgrades itself to `'dynamic'` so
   *   pixi's ticker re-picks while the pointer is stationary — animated scenes, orbiting cameras.
   *
   * An unset mode always resolves to `'passive'`. The renderer / `Application` `eventMode` init
   * option (pixi's `EventSystem.defaultEventMode`) applies only to 2D containers — a deliberate
   * divergence: 3D keeps an explicit pick list so hit-test cost scales with interactive nodes, and
   * a global interactive default would register the entire scene. Set `eventMode` per node (or per
   * group; the default already covers the subtree under it).
   * @default 'passive'
   * @example
   * ```ts
   * button.eventMode = 'static';   // standard clickable mesh
   * spinner.eventMode = 'dynamic'; // it moves under a still pointer
   * panel.eventMode = 'none';      // decoration; skip it and its children
   *
   * // A whole model that answers as one target — child meshes need no setup
   * robot.eventMode = 'static';
   * ```
   */
  eventMode: EventMode;

  /**
   * Boolean sugar over {@link IFederatedContainer3D#eventMode | eventMode}, matching pixi 2D
   *
   * `true` sets `'static'`, `false` sets `'passive'`; reads `true` for both `'static'` and `'dynamic'`.
   * Note that `false` is not a full opt-out: under an interactive ancestor a `'passive'` node is still
   * ray-tested with that ancestor as target. Set `eventMode = 'none'` to remove a node — and its
   * subtree — from picking entirely.
   * @example
   * ```ts
   * mesh.interactive = true;  // eventMode = 'static'
   * mesh.interactive = false; // eventMode = 'passive'
   * ```
   */
  interactive: boolean;

  /**
   * Whether this node fires listeners and can be an event target
   *
   * True for `eventMode` `'static'` and `'dynamic'`, mirroring pixi 2D. An `'auto'` node reads
   * `false`: it is ray-tested, but its hits target the nearest interactive ancestor.
   * @returns `true` when the node fires listeners and can be an event target.
   * @example
   * ```ts
   * mesh.eventMode = 'dynamic';
   * mesh.isInteractive(); // true
   *
   * mesh.eventMode = 'auto';
   * mesh.isInteractive(); // false — hit tested, but never the target
   * ```
   */
  isInteractive(): boolean;

  /**
   * Backing store for {@link IFederatedContainer3D#interactiveChildren | interactiveChildren}
   *
   * Public so ancestor walks (`getAncestorPickState`, the pick-time prune) read the field directly
   * instead of going through the accessor.
   * @internal
   */
  _interactiveChildren: boolean;

  /**
   * Whether this container's descendants take part in picking
   *
   * `false` makes the node a barrier, like `eventMode: 'none'` seen from below: descendants neither
   * pick nor occlude. The node itself is untouched — it still picks by its own `eventMode` and
   * volume, so the group can answer for the whole subtree. Mirrors pixi 2D's
   * `Container.interactiveChildren`.
   *
   * More than a pick-time filter: flipping it registers / unregisters the subtree on the owning
   * View's pick list at mutation time, so a disabled group costs nothing per pointer event — no
   * broadphase, no ray tests. Every descendant's `eventMode` survives intact for the flip back.
   * @default true
   * @example
   * ```ts
   * menu.interactiveChildren = false; // dim the menu: nothing in it can be picked
   * menu.interactiveChildren = true;  // ...and back, with every button's eventMode intact
   *
   * // Group collider: one registered node, one ray test, whole-subtree semantics.
   * // The explicit volume also clips as usual — see {@link IFederatedContainer3D#hitVolume}.
   * robot.eventMode = 'static';
   * robot.hitVolume = new Sphere(new Vector3(), 2);
   * robot.interactiveChildren = false;
   * ```
   */
  interactiveChildren: boolean;

  /**
   * CSS cursor to show while the pointer is over this node
   *
   * `null` (the default) falls back to the owning {@link View3D}'s own cursor. There is no
   * per-ancestor inheritance walk — 2D reads only the hit target's cursor, and the View-level fallback
   * is the one 3D addition.
   *
   * The View3D's interaction layer forwards the picked node's cursor to pixi's cursor system on every
   * pointer move. Typed as pixi's `Cursor` for keyword completion, widened with `string` so any other
   * CSS cursor value — `url(...)` and friends — is accepted too.
   * @default null
   * @example
   * ```ts
   * button.cursor = 'pointer';
   * handle.cursor = 'grab';
   * blade.cursor = 'url("crosshair.png") 8 8, crosshair'; // custom, with a hotspot
   * ```
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/CSS/cursor} MDN Cursor Documentation
   */
  cursor: Cursor | (string & {}) | null;

  /**
   * The verbatim hit volume the user set — what the getter returns
   * @internal
   */
  _hitVolumeInput: HitVolume3DInput | null;

  /**
   * The resolved shape used at pick time (`Box`, `Sphere`, or `Geometry3D`). Strings are
   * resolved against this node at set time; raw shapes are stored as-is. Read by the pick loop directly.
   * @internal
   */
  _hitVolumeResolved: HitVolume3D | null;

  /**
   * Hit shape used when picking this node — the 3D analogue of pixi 2D's `hitArea`
   *
   * Purely the shape: picking is opted into through
   * {@link IFederatedContainer3D#eventMode | eventMode} / `interactive`. On a `'none'` node the
   * volume is inert; on a `'passive'` / `'auto'` node it is ray-tested only while an interactive
   * ancestor exists, targeting that ancestor — as in 2D.
   *
   * When `null` (the default) an interactive `Mesh3D` falls back to its live geometry AABB; a plain
   * interactive `Container3D` has no implicit shape and only hears events bubbled from descendants
   * (2D `Container` parity).
   *
   * Accepts strings for the common cases — `'box'` for an AABB read from this node's bounds,
   * `'geometry'` for per-triangle against this `Mesh3D`'s own geometry — a raw `Box` / `Sphere` /
   * `Geometry3D` instance for snapshot semantics and Unity-style proxy colliders, or any
   * {@link IHitVolume3D} for shapes of your own.
   *
   * An **explicit** volume also clips this node's descendants, exactly as a 2D `hitArea` does: a
   * descendant's hit counts only while the hit point lies inside every explicit ancestor volume on
   * its chain, whatever those ancestors' `eventMode`s are, and a clipped hit is skipped without
   * occluding what's behind it. Default volumes (the `Mesh3D` AABB fallback) never clip — like an
   * unset 2D `hitArea`. Containment is exact for `Box` / `Sphere`, by the `bounds3D` AABB for a
   * `Geometry3D`, and through the optional `containsPoint` of an {@link IHitVolume3D} (absent, it
   * never clips). A clip volume doubles as a broadphase gate for its subtree: a ray that misses it
   * skips every covered descendant with a single test.
   * @default null
   * @example
   * ```ts
   * mesh.interactive = true;                  // pickable via its AABB
   * mesh.hitVolume = 'geometry';              // opt into per-triangle precision
   * mesh.hitVolume = new Sphere(center, 0.4); // custom / optimised shape
   * mesh.hitVolume = null;                    // back to the default AABB
   *
   * // Clip: children of the porthole only pick inside its sphere
   * porthole.hitVolume = new Sphere(new Vector3(), 1);
   * ```
   * @see {@link HitVolume3DInput} For what each accepted value resolves to.
   */
  hitVolume: HitVolume3DInput | null;

  /**
   * Per-pick memo for the ancestor-clip prefilter: the pick stamp this node's clip volume
   * was last ray-tested under. Compared against a module-global counter in `EventBoundary3D`, so a
   * clip ancestor is ray-tested once per pick however many descendants it covers.
   * @internal
   */
  _clipRayStamp: number;

  /**
   * The memoized verdict of the clip-prefilter ray test for `_clipRayStamp`'s pick
   * @internal
   */
  _clipRayHit: boolean;

  /**
   * Whether this node's own mode makes it a pick candidate — `'static'`, `'dynamic'` or
   * `'auto'`. Candidacy registers the node while no ancestor is a barrier (`eventMode: 'none'` or
   * `interactiveChildren: false`); a `'passive'` node can additionally be registered implicitly when
   * it bears a volume under an interactive ancestor. See
   * `_pickIndex`.
   * @returns `true` when the node's own mode makes it a candidate.
   * @internal
   */
  _isPickCandidate(): boolean;

  /**
   * This node's slot in its View's flat pick list, `-1` while off the list. The single
   * source of truth every registration path diffs against — the `eventMode` / `interactiveChildren` /
   * `hitVolume` setters, attach / detach, and the subtree cascades — so adds and removes stay exact
   * and idempotent, and what lets a removal swap-fill its slot in O(1). Written only by
   * `EventBoundary3D._addInteractive` / `_removeInteractive`.
   * @internal
   */
  _pickIndex: number;

  /**
   * Whether picking this node has a shape to test — an explicit
   * {@link IFederatedContainer3D#hitVolume | hitVolume}, or a default volume (a `Mesh3D`'s live
   * geometry AABB). Gates implicit registration of `'passive'` nodes: a volume-less container can
   * never be struck, so it stays off the pick list.
   * @returns `true` when the node has a shape the pick ray can test.
   * @internal
   */
  _hasPickVolume(): boolean;

  /**
   * Hit shape used when the node is interactive but `hitVolume` is unset. Base containers
   * have none (2D `Container` parity — bubble-only); `Mesh3D` overrides with its live geometry AABB,
   * the Sprite-bounds analogue.
   * @returns The implicit hit volume, or `null` when the node has none.
   * @internal
   */
  _getDefaultHitVolume(): HitVolume3D | null;

  /**
   * Lazily allocated on first pick, so the non-interactive majority carries no matrix
   * @internal
   */
  _invWorldTransform: Matrix4 | null;
  /**
   * The `_worldTransformId` the cached inverse was computed for
   * @internal
   */
  _invWorldTransformId: number;

  /**
   * Cached conservative world-space scale factor, squared — see `_getWorldScaleSq`
   * @internal
   */
  _worldScaleSq: number;
  /**
   * The `_worldTransformId` the cached scale factor was computed for
   * @internal
   */
  _worldScaleSqId: number;

  /**
   * Inverse of `worldTransform`, recomputed only when the transform pass bumps
   * `_worldTransformId`. The pick loop uses it to bring the pick ray into local space and to build the
   * normal matrix, so a static interactive node costs one inverse in total rather than one per pointer
   * event.
   * @returns The cached inverse world transform, owned by this node.
   * @internal
   */
  _getInverseWorldTransform(): Matrix4;

  /**
   * Conservative squared world-space scale factor — the squared largest singular value of
   * `worldTransform` — cached against `_worldTransformId`. The picker sizes its broadphase sphere by
   * multiplying this with the volume's squared local bounding radius, read at pick time so in-place
   * volume edits stay tracked; both are squared so no `sqrt` is needed. Uses the true singular value
   * rather than the max axis scale, so the bound stays conservative even when a non-uniformly scaled
   * ancestor shears the transform.
   * @returns The squared world-space scale factor.
   * @internal
   */
  _getWorldScaleSq(): number;

  /**
   * Property-based handler for the `click` event
   *
   * Fired when a pointer completes a click on this node.
   * @default null
   * @example
   * ```ts
   * mesh.eventMode = 'static';
   * mesh.onclick = (e) => {
   *   if (e.hit3D) spawnDecal(e.hit3D.point, e.hit3D.normal);
   * };
   * ```
   */
  onclick: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `mousedown` event
   *
   * Fired when a mouse button goes down over this node.
   * @default null
   * @see {@link IFederatedContainer3D#onpointerdown} For the pointer-type-agnostic equivalent.
   */
  onmousedown: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `mouseenter` event
   *
   * Fired when the mouse enters this node. Does not bubble.
   * @default null
   * @see {@link IFederatedContainer3D#onpointerenter} For the pointer-type-agnostic equivalent.
   */
  onmouseenter: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `mouseleave` event
   *
   * Fired when the mouse leaves this node. Does not bubble.
   * @default null
   * @see {@link IFederatedContainer3D#onpointerleave} For the pointer-type-agnostic equivalent.
   */
  onmouseleave: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `mousemove` event
   *
   * Fired while the mouse moves across this node.
   * @default null
   * @see {@link IFederatedContainer3D#onpointermove} For the pointer-type-agnostic equivalent.
   */
  onmousemove: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `globalmousemove` event
   *
   * Fired on every mouse move over the canvas, wherever the pointer is.
   * @default null
   * @see {@link IFederatedContainer3D#onglobalpointermove} For the pointer-type-agnostic equivalent.
   */
  onglobalmousemove: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `mouseout` event
   *
   * Fired when the mouse moves off this node. Bubbles, unlike `mouseleave`.
   * @default null
   * @see {@link IFederatedContainer3D#onpointerout} For the pointer-type-agnostic equivalent.
   */
  onmouseout: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `mouseover` event
   *
   * Fired when the mouse moves onto this node. Bubbles, unlike `mouseenter`.
   * @default null
   * @see {@link IFederatedContainer3D#onpointerover} For the pointer-type-agnostic equivalent.
   */
  onmouseover: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `mouseup` event
   *
   * Fired when a mouse button is released over this node.
   * @default null
   * @see {@link IFederatedContainer3D#onpointerup} For the pointer-type-agnostic equivalent.
   */
  onmouseup: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `mouseupoutside` event
   *
   * Fired when a mouse button that went down on this node is released anywhere else.
   * @default null
   * @see {@link IFederatedContainer3D#onpointerupoutside} For the pointer-type-agnostic equivalent.
   */
  onmouseupoutside: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `pointercancel` event
   *
   * Exists for API parity only: pixi's federated layer never delivers pointer cancellation, so this
   * handler does not fire. 2D behaves identically.
   * @default null
   */
  onpointercancel: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `pointerdown` event
   *
   * Fired when a pointer goes down on this node — mouse, touch or pen alike.
   * @default null
   * @example
   * ```ts
   * handle.eventMode = 'static';
   * handle.onpointerdown = (e) => {
   *   if (!e.hit3D) return;
   *   dragOffset.copyFrom(e.hit3D.localPoint); // where on the handle it was grabbed
   *   dragging = true;
   * };
   * ```
   */
  onpointerdown: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `pointerenter` event
   *
   * Fired when a pointer enters this node. Does not bubble, so an ancestor hears it only when the
   * pointer enters the ancestor itself.
   * @default null
   * @example
   * ```ts
   * button.eventMode = 'static';
   * button.onpointerenter = () => button.scale.set(1.1);
   * ```
   */
  onpointerenter: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `pointerleave` event
   *
   * Fired when a pointer leaves this node. Does not bubble.
   * @default null
   * @example
   * ```ts
   * button.onpointerleave = () => button.scale.set(1);
   * ```
   */
  onpointerleave: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `pointermove` event
   *
   * Fired while a pointer moves across this node.
   * @default null
   * @example
   * ```ts
   * // Trail the cursor across the surface it is over
   * table.eventMode = 'static';
   * table.onpointermove = (e) => {
   *   if (e.hit3D) cursor3D.position.copyFrom(e.hit3D.point);
   * };
   * ```
   */
  onpointermove: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `globalpointermove` event
   *
   * Fired on every pointer move over the canvas, whether or not the pointer is over this node. The
   * node still needs `eventMode` `'static'` or `'dynamic'` to hear it.
   * @default null
   * @example
   * ```ts
   * // Keep a drag alive once the pointer runs off the dragged mesh
   * mesh.onglobalpointermove = (e) => {
   *   const hit = dragging && view3d.screenToWorld(e.global, ground);
   *   if (hit) mesh.position.copyFrom(hit);
   * };
   * ```
   */
  onglobalpointermove: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `pointerout` event
   *
   * Fired when a pointer moves off this node. Bubbles, unlike `pointerleave`.
   * @default null
   */
  onpointerout: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `pointerover` event
   *
   * Fired when a pointer moves onto this node. Bubbles, unlike `pointerenter`.
   * @default null
   */
  onpointerover: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `pointertap` event
   *
   * Fired when a pointer completes a tap on this node — the pointer-type-agnostic `click` / `tap`.
   * @default null
   * @example
   * ```ts
   * // Works for mouse and touch alike
   * mesh.eventMode = 'static';
   * mesh.onpointertap = (e) => select(e.target3D);
   * ```
   */
  onpointertap: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `pointerup` event
   *
   * Fired when a pointer is released over this node.
   * @default null
   * @example
   * ```ts
   * handle.onpointerup = () => { dragging = false; };
   * ```
   */
  onpointerup: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `pointerupoutside` event
   *
   * Fired when a pointer that went down on this node is released anywhere else. The event's
   * `target3D` names this node, but the surface fields read as a miss because the release ray landed
   * elsewhere.
   * @default null
   * @example
   * ```ts
   * // The release that ends a drag usually happens off the mesh
   * handle.onpointerupoutside = () => { dragging = false; };
   * ```
   */
  onpointerupoutside: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `rightclick` event
   *
   * Fired when a right-click completes on this node.
   * @default null
   */
  onrightclick: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `rightdown` event
   *
   * Fired when the right mouse button goes down over this node.
   * @default null
   */
  onrightdown: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `rightup` event
   *
   * Fired when the right mouse button is released over this node.
   * @default null
   */
  onrightup: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `rightupoutside` event
   *
   * Fired when the right mouse button that went down on this node is released anywhere else.
   * @default null
   */
  onrightupoutside: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `tap` event
   *
   * Fired when a touch completes a tap on this node.
   * @default null
   * @see {@link IFederatedContainer3D#onpointertap} For the pointer-type-agnostic equivalent.
   */
  ontap: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `touchcancel` event
   *
   * Exists for API parity only: pixi's federated layer never delivers touch cancellation, so this
   * handler does not fire. 2D behaves identically.
   * @default null
   */
  ontouchcancel: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `touchend` event
   *
   * Fired when a touch lifts off this node.
   * @default null
   * @see {@link IFederatedContainer3D#onpointerup} For the pointer-type-agnostic equivalent.
   */
  ontouchend: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `touchendoutside` event
   *
   * Fired when a touch that started on this node lifts off anywhere else.
   * @default null
   * @see {@link IFederatedContainer3D#onpointerupoutside} For the pointer-type-agnostic equivalent.
   */
  ontouchendoutside: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `touchmove` event
   *
   * Fired while a touch moves across this node.
   * @default null
   * @see {@link IFederatedContainer3D#onpointermove} For the pointer-type-agnostic equivalent.
   */
  ontouchmove: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `globaltouchmove` event
   *
   * Fired on every touch move over the canvas, wherever the touch is.
   * @default null
   * @see {@link IFederatedContainer3D#onglobalpointermove} For the pointer-type-agnostic equivalent.
   */
  onglobaltouchmove: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `touchstart` event
   *
   * Fired when a touch lands on this node.
   * @default null
   * @see {@link IFederatedContainer3D#onpointerdown} For the pointer-type-agnostic equivalent.
   */
  ontouchstart: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `wheel` event
   *
   * Fired when the wheel turns while the pointer is over this node.
   * @default null
   * @example
   * ```ts
   * // Scroll to push the hit surface away from the camera
   * panel.eventMode = 'static';
   * panel.onwheel = (e) => { panel.position.z += e.deltaY * 0.01; };
   * ```
   */
  onwheel: Wheel3DEventHandler | null;
}

/**
 * The `on*` handler-property keys of {@link IFederatedContainer3D}
 * @internal
 */
type OnHandlerKey = Extract<keyof IFederatedContainer3D, `on${string}`>;

/**
 * The interaction options merged into {@link Container3DOptions}
 *
 * `eventMode`, `interactive`, `interactiveChildren`, `cursor`, `hitVolume`, and every `on*` handler
 * property, typed exactly as their {@link IFederatedContainer3D} counterparts.
 *
 * Constructor-set event state is safe before the node is attached: the setters defer registration
 * work while `view3d` is `null`, and the attach walk derives it when the node joins a View's scene
 * graph.
 * @category events
 * @standard
 */
export interface Federated3DOptions extends Partial<
  Pick<
    IFederatedContainer3D,
    'eventMode' | 'interactive' | 'interactiveChildren' | 'cursor' | 'hitVolume' | OnHandlerKey
  >
> {}

/**
 * An ancestor is a **barrier** — `eventMode: 'none'` or `interactiveChildren: false` —
 * so nothing below it registers, own-mode candidates included.
 * @internal
 */
export const PICK_BLOCKED = 0;
/**
 * No barrier above, but no interactive ancestor either: an implicit hit could not resolve
 * @internal
 */
export const PICK_BARE = 1;
/**
 * An interactive ancestor exists with no barrier above: implicit registration applies
 * @internal
 */
export const PICK_COVERED = 2;

/**
 * What a node's ancestor chain means for pick registration
 * @internal
 */
export type AncestorPickState = typeof PICK_BLOCKED | typeof PICK_BARE | typeof PICK_COVERED;

/**
 * Classifies `node`'s ancestor chain for pick registration
 *
 * A **barrier** is a node with `eventMode: 'none'` or `interactiveChildren: false`, as seen by its
 * descendants — the node's own registration is untouched. Mirrors the pruning in
 * `EventBoundary3D._resolvePickTarget`: a barrier anywhere on the chain blocks outright, otherwise
 * an interactive ancestor makes hits on a `'passive'` node resolvable.
 * @param node - Node whose ancestors are inspected.
 * @returns The ancestor state.
 * @internal
 */
export function getAncestorPickState(node: Container3D): AncestorPickState {
  let covered = false;
  let cur = node.parent;
  while (cur) {
    const mode = cur._eventMode;
    if (mode === 'none' || !cur._interactiveChildren) return PICK_BLOCKED;
    if (mode === 'static' || mode === 'dynamic') covered = true;
    cur = cur.parent;
  }
  return covered ? PICK_COVERED : PICK_BARE;
}

/**
 * Re-derives every registration below `node` after its barrier cleared
 *
 * Registers own-mode candidates (static / dynamic / auto) and, under an interactive ancestor,
 * volume-bearing `'passive'` descendants. Descent prunes at barrier children — nothing below one may
 * register — while the barrier child itself registers per its own rule, since its registration is
 * governed by its ancestors, not its own barrier.
 * @param node - Root of the cascade; only descendants are touched.
 * @param events - The owning View's boundary.
 * @param underInteractive - Whether nodes at this depth have an interactive ancestor.
 */
function registerSubtree(node: Container3D, events: EventBoundary3D, underInteractive: boolean): void {
  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const mode = child._eventMode;
    if (mode === 'none') continue;
    const interactive = mode === 'static' || mode === 'dynamic';
    if (interactive || mode === 'auto' || (underInteractive && child._hasPickVolume())) {
      events._addInteractive(child);
    }
    if (child._interactiveChildren) registerSubtree(child, events, underInteractive || interactive);
  }
}

/**
 * Strips every registration below `node` after it became a barrier — the inverse of
 * `registerSubtree`
 *
 * Unregisters every registered descendant, own-mode candidates included; `_removeInteractive` reads
 * each descendant's current mode, so a stripped `'dynamic'` node unwinds the View's dynamic count.
 * Descent prunes at barrier children — nothing was registered below them — after unregistering the
 * barrier child itself.
 * @param node - Root of the cascade; only descendants are touched.
 * @param events - The owning View's boundary.
 */
function unregisterSubtree(node: Container3D, events: EventBoundary3D): void {
  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child._pickIndex !== -1) events._removeInteractive(child);
    if (child._eventMode !== 'none' && child._interactiveChildren) unregisterSubtree(child, events);
  }
}

/**
 * Adds implicit registrations below `node` after a plain interactive flip gave its subtree cover
 *
 * Registers every volume-bearing `'passive'` descendant reachable without crossing a barrier.
 * Descent also stops at interactive descendants — their subtrees were covered before and are
 * unchanged — and below a non-descending barrier child nothing may register anyway.
 * @param node - Root of the cascade; only descendants are touched.
 * @param events - The owning View's boundary.
 */
function registerCoveredSubtree(node: Container3D, events: EventBoundary3D): void {
  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const mode = child._eventMode;
    if (mode === 'none') continue;
    const interactive = mode === 'static' || mode === 'dynamic';
    if (interactive) continue;
    if (mode !== 'auto' && child._hasPickVolume()) events._addInteractive(child);
    if (child._interactiveChildren) registerCoveredSubtree(child, events);
  }
}

/**
 * Removes implicit registrations below `node` after a plain interactive flip lost its subtree the
 * cover — the inverse of `registerCoveredSubtree`
 *
 * Unregisters every implicitly registered `'passive'` descendant. Barrier children are not descended
 * into — nothing below one is registered — and interactive descendants' subtrees are skipped too,
 * since they keep their own cover.
 * @param node - Root of the cascade; only descendants are touched.
 * @param events - The owning View's boundary.
 */
function unregisterCoveredSubtree(node: Container3D, events: EventBoundary3D): void {
  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const mode = child._eventMode;
    if (mode === 'none') continue;
    const interactive = mode === 'static' || mode === 'dynamic';
    if (interactive) continue;
    if (mode !== 'auto' && child._pickIndex !== -1) events._removeInteractive(child);
    if (child._interactiveChildren) unregisterCoveredSubtree(child, events);
  }
}

/**
 * The mixin applied to `Container3D.prototype` by `events/init.ts` — the 3D counterpart of
 * pixi.js's `FederatedContainer`. Property descriptors are copied verbatim, accessors included, so
 * every `Container3D` gains the interactive API without paying a per-instance cost for it.
 * {@link IFederatedContainer3D} is where these members are documented.
 * @internal
 */
export const FederatedContainer3D: IFederatedContainer3D & ThisType<Container3D> = {
  onclick: null,
  onmousedown: null,
  onmouseenter: null,
  onmouseleave: null,
  onmousemove: null,
  onglobalmousemove: null,
  onmouseout: null,
  onmouseover: null,
  onmouseup: null,
  onmouseupoutside: null,
  onpointercancel: null,
  onpointerdown: null,
  onpointerenter: null,
  onpointerleave: null,
  onpointermove: null,
  onglobalpointermove: null,
  onpointerout: null,
  onpointerover: null,
  onpointertap: null,
  onpointerup: null,
  onpointerupoutside: null,
  onrightclick: null,
  onrightdown: null,
  onrightup: null,
  onrightupoutside: null,
  ontap: null,
  ontouchcancel: null,
  ontouchend: null,
  ontouchendoutside: null,
  ontouchmove: null,
  onglobaltouchmove: null,
  ontouchstart: null,
  onwheel: null,

  _eventMode: undefined,

  get eventMode(): EventMode {
    return this._eventMode ?? 'passive';
  },

  set eventMode(value: EventMode) {
    const prev = this._eventMode ?? 'passive';
    this._eventMode = value;

    if (!this._view3d || value === prev) return;

    const events = this._view3d.events;
    const wasDynamic = prev === 'dynamic';

    // The ancestor walk is shared between the own-registration check and the cascade; -1 = not yet
    // computed.
    let ancestorState: AncestorPickState | -1 = -1;

    // Own registration: attached, no barrier above, and (own-mode candidate, or 'passive' with a
    // volume under an interactive ancestor). 'none' and volume-less 'passive' fail without the walk.
    let shouldRegister = false;
    if (value !== 'none' && (this._isPickCandidate() || this._hasPickVolume())) {
      ancestorState = getAncestorPickState(this);
      if (ancestorState !== PICK_BLOCKED) {
        shouldRegister = this._isPickCandidate() || ancestorState === PICK_COVERED;
      }
    }

    const registered = this._pickIndex !== -1;
    if (shouldRegister !== registered) {
      if (shouldRegister) {
        events._addInteractive(this);
      } else {
        events._removeInteractive(this, wasDynamic);
      }
    } else if (registered && wasDynamic !== (value === 'dynamic')) {
      // Registered before and after while flipping to/from 'dynamic' — keep the View's
      // dynamic-node count (and its own 2D eventMode) in sync.
      events._changeDynamicCount(value === 'dynamic' ? 1 : -1);
    }

    // Subtree cascade. Descendants care about this node in one of three roles: barrier ('none'
    // here, or `interactiveChildren: false` — unregisters everything below), interactive (covers
    // 'passive' descendants), or neutral ('passive' / 'auto'). No role change, no cascade; a node
    // that stays a barrier throughout keeps its subtree stripped whatever else changed.
    const wasInteractive = prev === 'static' || prev === 'dynamic';
    const nowInteractive = value === 'static' || value === 'dynamic';
    const wasBarrier = prev === 'none' || !this._interactiveChildren;
    const nowBarrier = value === 'none' || !this._interactiveChildren;
    if (
      (wasInteractive === nowInteractive && wasBarrier === nowBarrier) ||
      (wasBarrier && nowBarrier) ||
      this.children.length === 0
    ) {
      return;
    }

    if (ancestorState === -1) ancestorState = getAncestorPickState(this);
    // Blocked from above: nothing below is registered, and nothing may become so.
    if (ancestorState === PICK_BLOCKED) return;

    if (nowBarrier) {
      // Becoming a barrier strips the whole subtree — a cover loss below needs no separate pass.
      unregisterSubtree(this, events);
    } else if (wasBarrier) {
      // The barrier cleared: re-derive the subtree's registrations from scratch, cover included.
      registerSubtree(this, events, nowInteractive || ancestorState === PICK_COVERED);
    } else if (ancestorState !== PICK_COVERED) {
      // Interactive flip with no cover from above: 'passive' descendants gain or lose their only
      // interactive ancestor. Interactive descendants keep covering their own subtrees, so descent
      // prunes there. With cover from above, descendants were and remain covered — no-op.
      if (nowInteractive) {
        registerCoveredSubtree(this, events);
      } else {
        unregisterCoveredSubtree(this, events);
      }
    }
  },

  get interactive(): boolean {
    return this.isInteractive();
  },

  set interactive(value: boolean) {
    this.eventMode = value ? 'static' : 'passive';
  },

  isInteractive(): boolean {
    return this._eventMode === 'static' || this._eventMode === 'dynamic';
  },

  _isPickCandidate(): boolean {
    return this._eventMode === 'static' || this._eventMode === 'dynamic' || this._eventMode === 'auto';
  },

  _pickIndex: -1,

  _hasPickVolume(): boolean {
    return this._hitVolumeInput !== null || this._getDefaultHitVolume() !== null;
  },

  _interactiveChildren: true,

  get interactiveChildren(): boolean {
    return this._interactiveChildren;
  },

  set interactiveChildren(value: boolean) {
    const prev = this._interactiveChildren;
    this._interactiveChildren = value;

    // Own registration is untouched — the barrier is only visible to descendants.
    if (!this._view3d || value === prev || this.children.length === 0) return;

    // The barrier flips only when 'none' isn't holding it up on its own.
    if (this._eventMode === 'none') return;

    const ancestorState = getAncestorPickState(this);
    // Blocked from above: nothing below is registered, and nothing may become so.
    if (ancestorState === PICK_BLOCKED) return;

    const events = this._view3d.events;
    if (!value) {
      unregisterSubtree(this, events);
    } else {
      registerSubtree(this, events, this.isInteractive() || ancestorState === PICK_COVERED);
    }
  },

  cursor: null,

  _hitVolumeInput: null,
  _hitVolumeResolved: null,
  _clipRayStamp: 0,
  _clipRayHit: false,

  get hitVolume(): HitVolume3DInput | null {
    return this._hitVolumeInput;
  },

  set hitVolume(value: HitVolume3DInput | null) {
    const wasExplicit = this._hitVolumeInput !== null;
    this._hitVolumeInput = value;
    this._hitVolumeResolved = resolveHitVolume(this, value);

    if (!this._view3d) return;

    // Explicit volumes clip descendants; the boundary's count gates all per-pick clip work.
    if (wasExplicit !== (value !== null)) {
      this._view3d.events._clipVolumeCount += value !== null ? 1 : -1;
    }

    // A 'passive' node's implicit registration tracks volume presence: gaining a first volume under
    // an interactive ancestor registers it, losing the only volume unregisters. Own-mode
    // registrations (static / dynamic / auto) don't depend on the shape.
    if (this._eventMode !== undefined && this._eventMode !== 'passive') return;
    if (this._hasPickVolume() && getAncestorPickState(this) === PICK_COVERED) {
      this._view3d.events._addInteractive(this);
    } else {
      this._view3d.events._removeInteractive(this);
    }
  },

  _getDefaultHitVolume(): HitVolume3D | null {
    return null;
  },

  _invWorldTransform: null,
  _invWorldTransformId: -1,
  _worldScaleSq: 0,
  _worldScaleSqId: -1,

  _getInverseWorldTransform(): Matrix4 {
    if (this._invWorldTransform === null) {
      this._invWorldTransform = new Matrix4();
      this._invWorldTransformId = -1;
    }
    if (this._invWorldTransformId !== this._worldTransformId) {
      this._invWorldTransform.getInverse(this.worldTransform);
      this._invWorldTransformId = this._worldTransformId;
    }
    return this._invWorldTransform;
  },

  _getWorldScaleSq(): number {
    if (this._worldScaleSqId !== this._worldTransformId) {
      this._worldScaleSq = this.worldTransform.getMaxSingularValueSq();
      this._worldScaleSqId = this._worldTransformId;
    }
    return this._worldScaleSq;
  },
};

declare global {
  namespace PixiMixins {
    // oxlint-disable-next-line no-empty-object-type
    interface Container3D extends IFederatedContainer3D {}

    // oxlint-disable-next-line no-empty-object-type
    interface Container3DOptions extends Federated3DOptions {}

    // oxlint-disable-next-line no-empty-object-type
    interface Container3DEvents extends FederatedEventEmitterTypes3D {}
  }
}
