import type { Cursor, EventMode } from 'pixi.js';

import { Matrix4 } from '../math/matrix/Matrix4';
import type { Container3D } from '../scene/Container3D';
import type { EventBoundary3D } from './EventBoundary3D';
import type { FederatedEventEmitterTypes3D } from './FederatedEventMap3D';
import type { HitVolume3D, HitVolume3DInput } from './HitResult3D';
import type { Pointer3DEventHandler, Wheel3DEventHandler } from './Pointer3DEvent';
import { resolveHitVolume } from './resolveHitVolume';

/**
 * The pointer-event members of every {@link Container3D}
 *
 * They work as on a pixi.js `Container`. Set {@link IFederatedContainer3D#eventMode | eventMode}
 * to `'static'` and the node is picked by a ray from the pointer and fires its listeners. A
 * {@link Mesh3D} is picked against its geometry's bounding box unless you set a
 * {@link IFederatedContainer3D#hitVolume | hitVolume}. A plain `Container3D` has no shape of its
 * own, so it only hears events from its children.
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
 * - An `on*` handler property runs before the node's `on()` listeners in every phase, so an
 *   ancestor's handler runs twice per event, in the capture pass and again in the bubble pass. 2D
 *   does the same.
 * - Event objects are reused; see {@link Event3DFields} before keeping one.
 * @see {@link View3D#raycast} For a one-off pick that needs no listeners.
 * @category events
 * @standard
 */
export interface IFederatedContainer3D {
  /**
   * Backing field for {@link IFederatedContainer3D#eventMode | eventMode}, `undefined` until set
   *
   * The ancestor walks on the pick path read it directly rather than through the accessor.
   * @internal
   */
  _eventMode?: EventMode;

  /**
   * How this node takes part in pointer events, as on a pixi.js `Container`
   *
   * - `'none'`: never picked, and neither is anything below it. The subtree leaves the View's pick
   *   list, so it costs nothing per pointer event.
   * - `'passive'` (default): fires no listeners and is never the target. Under an interactive
   *   ancestor it is still picked, and the hit goes to that ancestor with this node's surface
   *   data. So one `'static'` group makes its whole subtree clickable, with the group as target.
   * - `'auto'`: picked like `'passive'`, and kept for 2D parity. Unlike `'passive'`, it is
   *   ray-tested even with no interactive ancestor, so prefer `'passive'`.
   * - `'static'`: picked against its {@link IFederatedContainer3D#hitVolume | hitVolume}, and fires
   *   listeners.
   * - `'dynamic'`: as `'static'`, and the {@link View3D} also picks again while the pointer is
   *   still, so a node that moves under a still pointer gets its enter and leave events.
   *
   * The renderer's `eventMode` option only sets the default for 2D containers, and the View warns
   * once when it isn't `'passive'`. A 3D node stays `'passive'` until you set it, because a
   * scene-wide interactive default would put every node on the pick list, and picking cost grows
   * with that list. Set the mode on the nodes and groups that need it.
   * @default 'passive'
   * @example
   * ```ts
   * button.eventMode = 'static';   // a clickable mesh
   * spinner.eventMode = 'dynamic'; // it moves under a still pointer
   * panel.eventMode = 'none';      // decoration; skip it and its children
   *
   * // A whole model that answers as one target; its meshes need no setup
   * robot.eventMode = 'static';
   * ```
   */
  eventMode: EventMode;

  /**
   * Shorthand for {@link IFederatedContainer3D#eventMode | eventMode}, as on a pixi.js `Container`
   *
   * `true` sets `'static'` and `false` sets `'passive'`. It reads `true` for `'static'` and
   * `'dynamic'`. `false` doesn't stop picking: under an interactive ancestor, a `'passive'` node is
   * still picked on that ancestor's behalf. Set `eventMode = 'none'` to take a node and its
   * subtree out of picking.
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
   * True for `eventMode` `'static'` and `'dynamic'`, as in 2D. An `'auto'` node reads `false`: it
   * can be ray-tested, but its hits go to the nearest interactive ancestor.
   * @returns `true` when the node fires listeners and can be an event target.
   * @example
   * ```ts
   * mesh.eventMode = 'dynamic';
   * mesh.isInteractive(); // true
   *
   * mesh.eventMode = 'auto';
   * mesh.isInteractive(); // false: hit-tested, but never the target
   * ```
   */
  isInteractive(): boolean;

  /**
   * Backing field for {@link IFederatedContainer3D#interactiveChildren | interactiveChildren}
   *
   * The ancestor walks on the pick path read it directly rather than through the accessor.
   * @internal
   */
  _interactiveChildren: boolean;

  /**
   * Whether this node's descendants can be picked, as on a pixi.js `Container`
   *
   * `false` takes the whole subtree out of picking: descendants neither hit nor block what is
   * behind them. The node itself still picks by its own `eventMode` and volume, so it can answer
   * for the subtree. The subtree leaves the View's pick list, so it costs nothing per pointer
   * event, and every descendant keeps its `eventMode` for when you turn it back on.
   * @default true
   * @example
   * ```ts
   * menu.interactiveChildren = false; // nothing in the menu can be picked
   * menu.interactiveChildren = true;  // every button picks again, eventMode intact
   *
   * // One sphere answers for the whole robot: one ray test instead of one per mesh
   * robot.eventMode = 'static';
   * robot.hitVolume = new Sphere(new Vector3(), 2);
   * robot.interactiveChildren = false;
   * ```
   */
  interactiveChildren: boolean;

  /**
   * CSS cursor shown while this node is the pointer's target
   *
   * Only the target's own cursor counts, as in 2D: a hit on a `'passive'` child shows its
   * interactive ancestor's cursor, so set it on the node with the listeners. `null` shows the
   * {@link View3D}'s own cursor. Any CSS cursor value works, `url(...)` included.
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
   * The value last assigned to `hitVolume`, which its getter returns
   * @internal
   */
  _hitVolumeInput: HitVolume3DInput | null;

  /**
   * The shape `resolveHitVolume` made of `_hitVolumeInput`, which the pick loop tests
   *
   * `null` when the input is `null` or invalid.
   * @internal
   */
  _hitVolumeResolved: HitVolume3D | null;

  /**
   * Shape the pointer ray is tested against when picking this node, like `hitArea` in 2D
   *
   * Setting it doesn't make the node interactive; {@link IFederatedContainer3D#eventMode | eventMode}
   * does that. Left `null`, a {@link Mesh3D} uses its geometry's bounding box and a plain
   * `Container3D` has no shape, so it only hears events from its children. Use `'box'` or
   * `'geometry'` to derive the shape from the node, a `Box`, `Sphere` or `Geometry3D` to give one
   * in the node's local space, or an {@link IHitVolume3D} of your own. {@link HitVolume3DInput}
   * covers each option.
   *
   * A shape you set also clips the node's descendants, as `hitArea` does in 2D: a descendant only
   * hits where the hit point is inside every such shape above it, whatever those nodes'
   * `eventMode`. A clipped hit doesn't block what is behind it. A `Geometry3D` clips by its bounding
   * box, an {@link IHitVolume3D} only through its optional `containsPoint`, and the default
   * bounding box never clips. A ray that misses the shape skips the exact test of every
   * descendant under it.
   * @default null
   * @example
   * ```ts
   * mesh.interactive = true;                  // picked by its bounding box
   * mesh.hitVolume = 'geometry';              // picked per triangle
   * mesh.hitVolume = new Sphere(center, 0.4); // a cheaper or tighter shape
   * mesh.hitVolume = null;                    // back to the bounding box
   *
   * // Children of the porthole only pick inside its sphere
   * porthole.hitVolume = new Sphere(new Vector3(), 1);
   * ```
   * @see {@link HitVolume3DInput} For what each accepted value resolves to.
   */
  hitVolume: HitVolume3DInput | null;

  /**
   * The pick this node's clip volume was last ray-tested in, compared against `_clipPickStamp` in
   * `EventBoundary3D`, so a clipping ancestor is tested once per pick however many descendants it
   * covers
   * @internal
   */
  _clipRayStamp: number;

  /**
   * Whether the ray hit this node's clip volume in the pick `_clipRayStamp` names
   * @internal
   */
  _clipRayHit: boolean;

  /**
   * Whether this node's own mode, `'static'`, `'dynamic'` or `'auto'`, puts it on the pick list
   *
   * It goes on the list while no ancestor is a barrier (`eventMode: 'none'` or
   * `interactiveChildren: false`). A `'passive'` node can also go on it, when it has a volume and an
   * interactive ancestor.
   * @returns `true` when the node's own mode makes it a candidate.
   * @internal
   */
  _isPickCandidate(): boolean;

  /**
   * This node's slot in its View's pick list, `-1` while off it
   *
   * Every registration path checks it: the `eventMode`, `interactiveChildren` and `hitVolume`
   * setters, attach and detach, and the subtree updates. That keeps adds and removes exact and safe
   * to repeat, and lets a removal fill the freed slot in O(1). Only
   * `EventBoundary3D._addInteractive` and `_removeInteractive` write it.
   * @internal
   */
  _pickIndex: number;

  /**
   * Whether the node has a shape to test: a `hitVolume`, or a default one such as a mesh's
   * bounding box
   *
   * A `'passive'` node without one can never be struck, so it stays off the pick list.
   * @returns `true` when the node has a shape the pick ray can test.
   * @internal
   */
  _hasPickVolume(): boolean;

  /**
   * The shape picked against when `hitVolume` is `null`
   *
   * A plain container has none, like a 2D `Container`; `Mesh3D` returns its geometry's bounding
   * box, as a 2D `Sprite` uses its bounds.
   * @returns The implicit hit volume, or `null` when the node has none.
   * @internal
   */
  _getDefaultHitVolume(): HitVolume3D | null;

  /**
   * Allocated on the first pick, so nodes that are never picked carry no matrix
   * @internal
   */
  _invWorldTransform: Matrix4 | null;
  /**
   * The `_worldTransformId` the cached inverse was computed for
   * @internal
   */
  _invWorldTransformId: number;

  /**
   * Cached result of `_getWorldScaleSq`
   * @internal
   */
  _worldScaleSq: number;
  /**
   * The `_worldTransformId` the cached scale factor was computed for
   * @internal
   */
  _worldScaleSqId: number;

  /**
   * Inverse of `worldTransform`, recomputed only when the transform pass changes
   * `_worldTransformId`
   *
   * The pick loop uses it to bring the ray into local space and to build the normal matrix, so a
   * node that doesn't move costs one inverse in total rather than one per pointer event.
   * @returns The cached inverse world transform, owned by this node.
   * @internal
   */
  _getInverseWorldTransform(): Matrix4;

  /**
   * The squared largest singular value of `worldTransform`, cached against `_worldTransformId`
   *
   * The picker sizes a node's broadphase sphere by multiplying it with the volume's squared local
   * radius, which it reads per pick so edits to the volume count; squaring both avoids a `sqrt`.
   * The singular value, unlike the largest axis scale, stays an upper bound when a non-uniformly
   * scaled ancestor shears the transform.
   * @returns The squared world-space scale factor.
   * @internal
   */
  _getWorldScaleSq(): number;

  /**
   * Property-based handler for the `click` event
   *
   * Fired when a mouse click on this node completes, with any button but the right one.
   * @default null
   * @example
   * ```ts
   * mesh.eventMode = 'static';
   * mesh.onclick = (e) => {
   *   if (e.hit3D) spawnDecal(e.hit3D.point, e.hit3D.normal);
   * };
   * ```
   * @see {@link IFederatedContainer3D#onpointertap} For the equivalent for every pointer type.
   */
  onclick: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `contextmenu` event
   *
   * Fired when the browser is about to open its context menu over this node; call
   * `preventDefault()` to keep it closed.
   * @default null
   * @example
   * ```ts
   * mesh.oncontextmenu = (e) => {
   *   e.preventDefault();
   *   openMenuFor(mesh, e.global);
   * };
   * ```
   */
  oncontextmenu: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `mousedown` event
   *
   * Fired when a mouse button other than the right one goes down over this node.
   * @default null
   * @example
   * ```ts
   * mesh.onmousedown = (e) => {
   *   if (e.button === 1) startPan(e.global); // middle button
   * };
   * ```
   * @see {@link IFederatedContainer3D#onpointerdown} For the equivalent for every pointer type.
   */
  onmousedown: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `mouseenter` event
   *
   * Fired when the mouse enters this node. Doesn't bubble.
   * @default null
   * @example
   * ```ts
   * mesh.onmouseenter = () => (tooltip.visible = true);
   * ```
   * @see {@link IFederatedContainer3D#onpointerenter} For the equivalent for every pointer type.
   */
  onmouseenter: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `mouseleave` event
   *
   * Fired when the mouse leaves this node. Doesn't bubble.
   * @default null
   * @example
   * ```ts
   * mesh.onmouseleave = () => (tooltip.visible = false);
   * ```
   * @see {@link IFederatedContainer3D#onpointerleave} For the equivalent for every pointer type.
   */
  onmouseleave: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `mousemove` event
   *
   * Fired while the mouse moves across this node.
   * @default null
   * @example
   * ```ts
   * mesh.onmousemove = (e) => tooltip.position.copyFrom(e.global);
   * ```
   * @see {@link IFederatedContainer3D#onpointermove} For the equivalent for every pointer type.
   */
  onmousemove: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `globalmousemove` event
   *
   * Fired on every mouse move over the canvas, wherever the pointer is.
   * @default null
   * @example
   * ```ts
   * mesh.onglobalmousemove = (e) => {
   *   if (dragging) dragTo(e.global);
   * };
   * ```
   * @see {@link IFederatedContainer3D#onglobalpointermove} For the equivalent for every pointer type.
   */
  onglobalmousemove: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `mouseout` event
   *
   * Fired when the mouse moves off this node. Bubbles, unlike `mouseleave`.
   * @default null
   * @example
   * ```ts
   * shelf.onmouseout = (e) => unhighlight(e.target3D);
   * ```
   * @see {@link IFederatedContainer3D#onpointerout} For the equivalent for every pointer type.
   */
  onmouseout: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `mouseover` event
   *
   * Fired when the mouse moves onto this node. Bubbles, unlike `mouseenter`.
   * @default null
   * @example
   * ```ts
   * // One handler on the shelf hears every item on it
   * shelf.onmouseover = (e) => highlight(e.target3D);
   * ```
   * @see {@link IFederatedContainer3D#onpointerover} For the equivalent for every pointer type.
   */
  onmouseover: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `mouseup` event
   *
   * Fired when a mouse button other than the right one is released over this node.
   * @default null
   * @example
   * ```ts
   * mesh.onmouseup = (e) => {
   *   if (e.button === 1) endPan();
   * };
   * ```
   * @see {@link IFederatedContainer3D#onpointerup} For the equivalent for every pointer type.
   */
  onmouseup: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `mouseupoutside` event
   *
   * Fired when a mouse button that went down on this node is released anywhere else.
   * @default null
   * @example
   * ```ts
   * mesh.onmouseupoutside = () => endPan();
   * ```
   * @see {@link IFederatedContainer3D#onpointerupoutside} For the equivalent for every pointer type.
   */
  onmouseupoutside: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `pointercancel` event
   *
   * Never called: pixi delivers no pointer cancellation, in 2D either. It exists so the 3D API
   * matches the 2D one.
   * @default null
   * @example
   * ```ts
   * // End a drag on these two instead
   * handle.onpointerup = endDrag;
   * handle.onpointerupoutside = endDrag;
   * ```
   */
  onpointercancel: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `pointerdown` event
   *
   * Fired when a pointer goes down on this node: mouse, touch or pen alike.
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
   * Fired when a pointer enters this node. Doesn't bubble, so an ancestor hears it only when the
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
   * Fired when a pointer leaves this node. Doesn't bubble.
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
   *   if (e.hit3D) cursorMarker.position.copyFrom(e.hit3D.point);
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
   * // Keep a drag going once the pointer runs off the dragged mesh
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
   * @example
   * ```ts
   * shelf.onpointerout = (e) => unhighlight(e.target3D);
   * ```
   */
  onpointerout: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `pointerover` event
   *
   * Fired when a pointer moves onto this node. Bubbles, unlike `pointerenter`.
   * @default null
   * @example
   * ```ts
   * // One handler on the shelf hears every item on it
   * shelf.onpointerover = (e) => highlight(e.target3D);
   * ```
   */
  onpointerover: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `pointertap` event
   *
   * Fired when a pointer completes a tap on this node: `click` and `tap` for any pointer type.
   * @default null
   * @example
   * ```ts
   * // Works for mouse, touch and pen alike
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
   * handle.onpointerup = () => {
   *   dragging = false;
   * };
   * ```
   */
  onpointerup: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `pointerupoutside` event
   *
   * Fired when a pointer that went down on this node is released anywhere else. The event's
   * `target3D` is this node, and `hit3D` is what the pointer was released over, if anything.
   * @default null
   * @example
   * ```ts
   * // The release that ends a drag usually happens off the mesh
   * handle.onpointerupoutside = () => {
   *   dragging = false;
   * };
   * ```
   */
  onpointerupoutside: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `rightclick` event
   *
   * Fired when a right click completes on this node.
   * @default null
   * @example
   * ```ts
   * mesh.onrightclick = () => openMenuFor(mesh);
   * ```
   */
  onrightclick: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `rightdown` event
   *
   * Fired when the right mouse button goes down over this node.
   * @default null
   * @example
   * ```ts
   * mesh.onrightdown = (e) => startRotate(e.global);
   * ```
   */
  onrightdown: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `rightup` event
   *
   * Fired when the right mouse button is released over this node.
   * @default null
   * @example
   * ```ts
   * mesh.onrightup = endRotate;
   * ```
   */
  onrightup: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `rightupoutside` event
   *
   * Fired when the right mouse button that went down on this node is released anywhere else.
   * @default null
   * @example
   * ```ts
   * mesh.onrightupoutside = endRotate;
   * ```
   */
  onrightupoutside: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `tap` event
   *
   * Fired when a touch completes a tap on this node.
   * @default null
   * @example
   * ```ts
   * mesh.ontap = (e) => {
   *   if (e.detail === 2) focusOn(mesh); // double tap
   * };
   * ```
   * @see {@link IFederatedContainer3D#onpointertap} For the equivalent for every pointer type.
   */
  ontap: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `touchcancel` event
   *
   * Never called: pixi delivers no touch cancellation, in 2D either. It exists so the 3D API
   * matches the 2D one.
   * @default null
   * @example
   * ```ts
   * // End a drag on these two instead
   * handle.ontouchend = endDrag;
   * handle.ontouchendoutside = endDrag;
   * ```
   */
  ontouchcancel: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `touchend` event
   *
   * Fired when a touch lifts off this node.
   * @default null
   * @example
   * ```ts
   * handle.ontouchend = endDrag;
   * ```
   * @see {@link IFederatedContainer3D#onpointerup} For the equivalent for every pointer type.
   */
  ontouchend: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `touchendoutside` event
   *
   * Fired when a touch that started on this node lifts off anywhere else.
   * @default null
   * @example
   * ```ts
   * handle.ontouchendoutside = endDrag;
   * ```
   * @see {@link IFederatedContainer3D#onpointerupoutside} For the equivalent for every pointer type.
   */
  ontouchendoutside: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `touchmove` event
   *
   * Fired while a touch moves across this node.
   * @default null
   * @example
   * ```ts
   * canvasMesh.ontouchmove = (e) => {
   *   if (e.hit3D) paintAt(e.hit3D.uv);
   * };
   * ```
   * @see {@link IFederatedContainer3D#onpointermove} For the equivalent for every pointer type.
   */
  ontouchmove: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `globaltouchmove` event
   *
   * Fired on every touch move over the canvas, wherever the touch is.
   * @default null
   * @example
   * ```ts
   * mesh.onglobaltouchmove = (e) => {
   *   if (dragging) dragTo(e.global);
   * };
   * ```
   * @see {@link IFederatedContainer3D#onglobalpointermove} For the equivalent for every pointer type.
   */
  onglobaltouchmove: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `touchstart` event
   *
   * Fired when a touch lands on this node.
   * @default null
   * @example
   * ```ts
   * handle.ontouchstart = (e) => startDrag(e.pointerId);
   * ```
   * @see {@link IFederatedContainer3D#onpointerdown} For the equivalent for every pointer type.
   */
  ontouchstart: Pointer3DEventHandler | null;

  /**
   * Property-based handler for the `wheel` event
   *
   * Fired when the wheel turns while the pointer is over this node.
   * @default null
   * @example
   * ```ts
   * // Scroll to push the panel away from the camera
   * panel.eventMode = 'static';
   * panel.onwheel = (e) => {
   *   panel.position.z += e.deltaY * 0.01;
   * };
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
 * The pointer-event options of {@link Container3DOptions}
 *
 * `eventMode`, `interactive`, `interactiveChildren`, `cursor`, `hitVolume`, and every `on*`
 * handler, as on {@link IFederatedContainer3D}. They can be set before the node joins a scene; it
 * goes on the pick list when it is added.
 * @example
 * ```ts
 * const door = new Container3D({
 *   eventMode: 'static',
 *   cursor: 'pointer',
 *   hitVolume: new Box(new Vector3(-1, 0, -0.1), new Vector3(1, 2, 0.1)),
 *   onpointertap: () => openDoor(),
 * });
 * ```
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
 * An ancestor is a barrier (`eventMode: 'none'` or `interactiveChildren: false`), so nothing below
 * it goes on the pick list, whatever its own mode
 * @internal
 */
export const PICK_BLOCKED = 0;
/**
 * No barrier above, but no interactive ancestor either, so a hit on a `'passive'` node would have
 * no target
 * @internal
 */
export const PICK_BARE = 1;
/**
 * An interactive ancestor and no barrier above, so a `'passive'` node with a volume goes on the
 * pick list
 * @internal
 */
export const PICK_COVERED = 2;

/**
 * What a node's ancestors mean for putting it on the pick list
 * @internal
 */
export type AncestorPickState = typeof PICK_BLOCKED | typeof PICK_BARE | typeof PICK_COVERED;

/**
 * Classifies `node`'s ancestors for putting it on the pick list
 *
 * A barrier is a node with `eventMode: 'none'` or `interactiveChildren: false`, as its
 * descendants see it; its own place on the list doesn't depend on it. A barrier anywhere above
 * blocks; otherwise an interactive ancestor covers the node. Two other places apply the same rule
 * and must agree with it: `EventBoundary3D._resolvePickTarget` at pick time, and `View3D._attach`,
 * which passes the state down a subtree as it attaches it.
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
 * Puts every node below `node` that belongs on the pick list back on it, after a barrier at
 * `node` cleared
 *
 * Adds nodes whose own mode makes them candidates (`'static'`, `'dynamic'`, `'auto'`) and, under
 * an interactive ancestor, `'passive'` nodes with a volume. It doesn't descend below a barrier
 * child, where nothing may register, but the barrier child itself registers by its own rule: a
 * node's barrier only affects its descendants.
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
 * Takes every node below `node` off the pick list after `node` became a barrier; the inverse of
 * `registerSubtree`
 *
 * `_removeInteractive` reads each node's current mode, so removing a `'dynamic'` node lowers the
 * View's dynamic count. It doesn't descend below a barrier child, since nothing below one is on
 * the list, but it removes the barrier child itself.
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
 * Adds the `'passive'` nodes with a volume below `node`, after `node` became interactive with no
 * interactive ancestor of its own
 *
 * It doesn't descend below a barrier, where nothing may register, or below an interactive
 * descendant, whose subtree was already covered.
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
 * Removes the `'passive'` nodes below `node` from the pick list, after `node` stopped being
 * interactive with no interactive ancestor of its own; the inverse of `registerCoveredSubtree`
 *
 * It doesn't descend below a barrier, where nothing is registered, or below an interactive
 * descendant, which still covers its own subtree.
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
 * What `events/init.ts` mixes into `Container3D.prototype`, as pixi.js mixes `FederatedContainer`
 * into `Container`
 *
 * `extensions.mixin` copies the property descriptors, accessors included. State lives on the
 * prototype with inert defaults (`null`, `undefined`, `-1`), so a node that never uses events
 * carries no storage for them; the first write gives the node its own property.
 * {@link IFederatedContainer3D} documents the members.
 * @internal
 */
export const FederatedContainer3D: IFederatedContainer3D & ThisType<Container3D> = {
  onclick: null,
  oncontextmenu: null,
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

  /**
   * Updates the pick list for the new mode: this node first, then its subtree
   *
   * This node belongs on the list when no ancestor is a barrier and either its own mode makes it a
   * candidate or it is `'passive'` with a volume under an interactive ancestor. `'none'` and a
   * `'passive'` node without a volume fail before the ancestor walk; the walk's result is shared
   * with the subtree step, and `ancestorState` is `-1` until it runs. A node that stays on the list
   * while switching to or from `'dynamic'` only changes the View's dynamic count, which also sets
   * the View's own `eventMode`.
   *
   * Descendants see this node in one of three roles: a barrier (`'none'`, or
   * `interactiveChildren: false`), an interactive ancestor that covers `'passive'` descendants, or
   * neither. The subtree only changes when the role does, never while the node stays a barrier,
   * and never while an ancestor blocks it. Becoming a barrier takes the whole subtree off, which
   * also covers losing interactivity. Clearing a barrier works the subtree out again from scratch.
   * Gaining or losing interactivity with no interactive ancestor adds or removes the `'passive'`
   * descendants; with one, they were covered before and still are.
   * @param value - The new mode.
   */
  set eventMode(value: EventMode) {
    const prev = this._eventMode ?? 'passive';
    this._eventMode = value;

    if (!this._view3d || value === prev) return;

    const events = this._view3d.events;
    const wasDynamic = prev === 'dynamic';

    let ancestorState: AncestorPickState | -1 = -1;

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
      events._changeDynamicCount(value === 'dynamic' ? 1 : -1);
    }

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
    if (ancestorState === PICK_BLOCKED) return;

    if (nowBarrier) {
      unregisterSubtree(this, events);
    } else if (wasBarrier) {
      registerSubtree(this, events, nowInteractive || ancestorState === PICK_COVERED);
    } else if (ancestorState !== PICK_COVERED) {
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

  /**
   * Takes the subtree off the pick list, or works it out again, when the barrier this node forms
   * appears or clears
   *
   * The node's own place on the list doesn't change: descendants are the only ones that see a
   * barrier. Nothing changes while `eventMode` is `'none'`, which is a barrier on its own, or while
   * an ancestor blocks the subtree.
   * @param value - Whether descendants can be picked.
   */
  set interactiveChildren(value: boolean) {
    const prev = this._interactiveChildren;
    this._interactiveChildren = value;

    if (!this._view3d || value === prev || this.children.length === 0) return;

    if (this._eventMode === 'none') return;

    const ancestorState = getAncestorPickState(this);
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

  /**
   * Resolves the shape and keeps the View's pick state in step with it
   *
   * Going between `null` and a volume changes the View's clip-volume count, which gates all clip
   * work per pick. A `'passive'` node is only on the pick list while it has a volume under an
   * interactive ancestor, so it is added or removed here; the other modes don't depend on the
   * shape.
   * @param value - The new hit volume.
   */
  set hitVolume(value: HitVolume3DInput | null) {
    const wasExplicit = this._hitVolumeInput !== null;
    this._hitVolumeInput = value;
    this._hitVolumeResolved = resolveHitVolume(this, value);

    if (!this._view3d) return;

    if (wasExplicit !== (value !== null)) {
      this._view3d.events._clipVolumeCount += value !== null ? 1 : -1;
    }

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
    interface Container3D extends IFederatedContainer3D {}

    interface Container3DOptions extends Federated3DOptions {}

    interface Container3DEvents extends FederatedEventEmitterTypes3D {}
  }
}
