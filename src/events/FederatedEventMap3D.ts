import type { Pointer3DEvent, Wheel3DEvent } from './Pointer3DEvent';

/**
 * The pointer events a {@link Container3D} can emit, keyed by event name
 *
 * The 3D counterpart of pixi.js's `FederatedEventMap`. Each event is pixi's own event object with
 * the {@link Event3DFields | 3D fields} added, so one handler reads both the 2D pointer position
 * and the 3D surface it landed on.
 * @example
 * ```ts
 * mesh.eventMode = 'static';
 * mesh.hitVolume = 'geometry'; // per triangle, so hits carry a uv
 * mesh.on('pointertap', (e) => {
 *   if (!e.hit3D) return;
 *   marker.position.copyFrom(e.hit3D.point); // where on the mesh the ray landed
 *   hoveredUv.copyFrom(e.hit3D.uv);          // and where on its texture
 * });
 * ```
 * @see {@link GlobalFederatedEventMap3D} For the moves delivered whatever the pointer is over.
 * @see {@link Event3DFields} For the 3D fields and how long they stay valid.
 * @category events
 * @standard
 */
export type FederatedEventMap3D = {
  /**
   * Fired when a mouse click on this node completes, with any button but the right one
   *
   * `detail` counts repeat clicks on the same node, each within 200 ms of the last, so `2` is a
   * double click. A pen fires only `pointertap`.
   * @example
   * ```ts
   * mesh.on('click', (e) => {
   *   if (e.detail === 2) focusOn(mesh);
   * });
   * ```
   */
  click: Pointer3DEvent;
  /**
   * Fired when the browser is about to open its context menu over this node
   *
   * Call `preventDefault()` to keep the menu closed, or `stopPropagation()` to keep the browser's
   * menu and hide the event from the View's own listeners, such as a camera controller's.
   * @example
   * ```ts
   * mesh.on('contextmenu', (e) => {
   *   e.preventDefault();
   *   openMenuFor(mesh, e.global);
   * });
   * ```
   */
  contextmenu: Pointer3DEvent;
  /**
   * Fired when a mouse button other than the right one goes down over this node
   * @example
   * ```ts
   * mesh.on('mousedown', (e) => {
   *   if (e.button === 1) startPan(e.global); // middle button
   * });
   * ```
   */
  mousedown: Pointer3DEvent;
  /**
   * Fired when the mouse enters this node; doesn't bubble
   * @example
   * ```ts
   * mesh.on('mouseenter', () => (tooltip.visible = true));
   * ```
   */
  mouseenter: Pointer3DEvent;
  /**
   * Fired when the mouse leaves this node; doesn't bubble
   * @example
   * ```ts
   * mesh.on('mouseleave', () => (tooltip.visible = false));
   * ```
   */
  mouseleave: Pointer3DEvent;
  /**
   * Fired while the mouse moves across this node
   * @example
   * ```ts
   * mesh.on('mousemove', (e) => tooltip.position.copyFrom(e.global));
   * ```
   */
  mousemove: Pointer3DEvent;
  /**
   * Fired when the mouse moves off this node; bubbles, unlike `mouseleave`
   * @example
   * ```ts
   * shelf.on('mouseout', (e) => unhighlight(e.target3D));
   * ```
   */
  mouseout: Pointer3DEvent;
  /**
   * Fired when the mouse moves onto this node; bubbles, unlike `mouseenter`
   * @example
   * ```ts
   * // One listener on the shelf hears every item on it
   * shelf.on('mouseover', (e) => highlight(e.target3D));
   * ```
   */
  mouseover: Pointer3DEvent;
  /**
   * Fired when a mouse button other than the right one is released over this node
   * @example
   * ```ts
   * mesh.on('mouseup', (e) => {
   *   if (e.button === 1) endPan();
   * });
   * ```
   */
  mouseup: Pointer3DEvent;
  /**
   * Fired when a mouse button that went down on this node is released anywhere else
   * @example
   * ```ts
   * mesh.on('mouseupoutside', () => endPan());
   * ```
   */
  mouseupoutside: Pointer3DEvent;
  /**
   * Never fired: pixi delivers no pointer cancellation, in 2D either
   * @example
   * ```ts
   * // End a drag on these two instead
   * handle.on('pointerup', endDrag);
   * handle.on('pointerupoutside', endDrag);
   * ```
   */
  pointercancel: Pointer3DEvent;
  /**
   * Fired when a pointer goes down on this node: mouse, touch or pen alike
   * @example
   * ```ts
   * handle.on('pointerdown', (e) => {
   *   if (e.hit3D) grabOffset.copyFrom(e.hit3D.localPoint);
   * });
   * ```
   */
  pointerdown: Pointer3DEvent;
  /**
   * Fired when a pointer enters this node; doesn't bubble
   * @example
   * ```ts
   * button.on('pointerenter', () => button.scale.set(1.1));
   * ```
   */
  pointerenter: Pointer3DEvent;
  /**
   * Fired when a pointer leaves this node; doesn't bubble
   * @example
   * ```ts
   * button.on('pointerleave', () => button.scale.set(1));
   * ```
   */
  pointerleave: Pointer3DEvent;
  /**
   * Fired while a pointer moves across this node
   * @example
   * ```ts
   * table.on('pointermove', (e) => {
   *   if (e.hit3D) cursorMarker.position.copyFrom(e.hit3D.point);
   * });
   * ```
   */
  pointermove: Pointer3DEvent;
  /**
   * Fired when a pointer moves off this node; bubbles, unlike `pointerleave`
   * @example
   * ```ts
   * shelf.on('pointerout', (e) => unhighlight(e.target3D));
   * ```
   */
  pointerout: Pointer3DEvent;
  /**
   * Fired when a pointer moves onto this node; bubbles, unlike `pointerenter`
   * @example
   * ```ts
   * // One listener on the shelf hears every item on it
   * shelf.on('pointerover', (e) => highlight(e.target3D));
   * ```
   */
  pointerover: Pointer3DEvent;
  /**
   * Fired when a pointer completes a tap on this node, for any pointer type and any button, right
   * clicks included
   * @example
   * ```ts
   * mesh.on('pointertap', () => select(mesh));
   * ```
   */
  pointertap: Pointer3DEvent;
  /**
   * Fired when a pointer is released over this node
   * @example
   * ```ts
   * handle.on('pointerup', endDrag);
   * ```
   */
  pointerup: Pointer3DEvent;
  /**
   * Fired when a pointer that went down on this node is released anywhere else
   *
   * `hit3D` says what the pointer was released over, if anything.
   * @example
   * ```ts
   * crate.on('pointerupoutside', (e) => {
   *   if (e.hit3D) dropOnto(e.hit3D.target);
   *   endDrag();
   * });
   * ```
   */
  pointerupoutside: Pointer3DEvent;
  /**
   * Fired when a right click completes on this node
   * @example
   * ```ts
   * mesh.on('rightclick', () => openMenuFor(mesh));
   * ```
   */
  rightclick: Pointer3DEvent;
  /**
   * Fired when the right mouse button goes down over this node
   * @example
   * ```ts
   * mesh.on('rightdown', (e) => startRotate(e.global));
   * ```
   */
  rightdown: Pointer3DEvent;
  /**
   * Fired when the right mouse button is released over this node
   * @example
   * ```ts
   * mesh.on('rightup', endRotate);
   * ```
   */
  rightup: Pointer3DEvent;
  /**
   * Fired when the right mouse button that went down on this node is released anywhere else
   * @example
   * ```ts
   * mesh.on('rightupoutside', endRotate);
   * ```
   */
  rightupoutside: Pointer3DEvent;
  /**
   * Fired when a touch completes a tap on this node
   *
   * Chrome gives each touch a new `pointerId`, and `detail` only counts repeat taps by the same one,
   * so it stays `1` there; time a double tap yourself.
   * @example
   * ```ts
   * let lastTap = 0;
   * mesh.on('tap', (e) => {
   *   if (e.timeStamp - lastTap < 300) focusOn(mesh); // double tap
   *   lastTap = e.timeStamp;
   * });
   * ```
   */
  tap: Pointer3DEvent;
  /**
   * Never fired: pixi delivers no touch cancellation, in 2D either
   * @example
   * ```ts
   * // End a drag on these two instead
   * handle.on('touchend', endDrag);
   * handle.on('touchendoutside', endDrag);
   * ```
   */
  touchcancel: Pointer3DEvent;
  /**
   * Fired when a touch lifts off this node
   * @example
   * ```ts
   * handle.on('touchend', endDrag);
   * ```
   */
  touchend: Pointer3DEvent;
  /**
   * Fired when a touch that started on this node lifts off anywhere else
   * @example
   * ```ts
   * handle.on('touchendoutside', endDrag);
   * ```
   */
  touchendoutside: Pointer3DEvent;
  /**
   * Fired while a touch moves across this node
   * @example
   * ```ts
   * canvasMesh.hitVolume = 'geometry'; // per triangle, so hits carry a uv
   * canvasMesh.on('touchmove', (e) => {
   *   if (e.hit3D) paintAt(e.hit3D.uv);
   * });
   * ```
   */
  touchmove: Pointer3DEvent;
  /**
   * Fired when a touch lands on this node
   * @example
   * ```ts
   * handle.on('touchstart', (e) => startDrag(e.pointerId));
   * ```
   */
  touchstart: Pointer3DEvent;
  /**
   * Fired when the wheel turns while the pointer is over this node
   * @example
   * ```ts
   * panel.on('wheel', (e) => {
   *   panel.position.z += e.deltaY * 0.01;
   * });
   * ```
   */
  wheel: Wheel3DEvent;
};

/**
 * The move events an interactive {@link Container3D} hears wherever the pointer is
 *
 * Every interactive node in the View hears them on every pointer move on the page, as in
 * pixi.js's `GlobalFederatedEventMap`, and there is no capture variant. The 3D fields carry the
 * View's pick for that move, not the node being told, and read `null` when the ray hit nothing.
 * @example
 * ```ts
 * // Drag a mesh along the ground plane, even once the pointer leaves it
 * mesh.eventMode = 'static';
 * mesh.on('globalpointermove', (e) => {
 *   const hit = dragging && view3d.screenToWorld(e.global, ground);
 *   if (hit) mesh.position.copyFrom(hit);
 * });
 * ```
 * @see {@link EventBoundary3D#enableGlobalMoveEvents} To turn them off for a View.
 * @category events
 * @standard
 */
export type GlobalFederatedEventMap3D = {
  /**
   * Fired on every mouse move, wherever the pointer is on the page
   * @example
   * ```ts
   * mesh.on('globalmousemove', (e) => {
   *   if (dragging) dragTo(e.global);
   * });
   * ```
   */
  globalmousemove: Pointer3DEvent;
  /**
   * Fired on every pointer move on the page, whether or not the pointer is over this node
   * @example
   * ```ts
   * mesh.on('globalpointermove', (e) => {
   *   if (dragging) dragTo(e.global);
   * });
   * ```
   */
  globalpointermove: Pointer3DEvent;
  /**
   * Fired on every touch move, wherever the touch is on the page
   * @example
   * ```ts
   * mesh.on('globaltouchmove', (e) => {
   *   if (dragging) dragTo(e.global);
   * });
   * ```
   */
  globaltouchmove: Pointer3DEvent;
};

/**
 * @interface
 * @internal
 */
export type FederatedEventEmitterTypes3D = {
  [K in keyof FederatedEventMap3D as K | `${K}capture`]: [event: FederatedEventMap3D[K]];
} & {
  [K in keyof GlobalFederatedEventMap3D]: [event: GlobalFederatedEventMap3D[K]];
};
