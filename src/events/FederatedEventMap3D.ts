import type { Pointer3DEvent, Wheel3DEvent } from './Pointer3DEvent';

/**
 * The pointer events a {@link Container3D} can emit, keyed by event name
 *
 * The 3D counterpart of pixi.js's `FederatedEventMap`. Every payload is the live (pooled) federated
 * event augmented with the {@link Event3DFields | 3D hit fields}, so one handler reads both the 2D
 * pointer position and the 3D surface it landed on.
 * @example
 * ```ts
 * mesh.eventMode = 'static';
 * mesh.on('pointertap', (e) => {
 *   if (!e.hit3D) return;
 *   marker.position.copyFrom(e.hit3D.point); // where on the mesh the ray landed
 *   hoveredUv.copyFrom(e.hit3D.uv);          // and where on its texture
 * });
 * ```
 * @see {@link GlobalFederatedEventMap3D} For the moves delivered whatever the pointer is over.
 * @see {@link Event3DFields} For the 3D fields and their lifetime contract.
 * @category events
 * @standard
 */
export type FederatedEventMap3D = {
  /** Fired when a pointer completes a click on this node */
  click: Pointer3DEvent;
  /** Fired when a mouse button goes down over this node */
  mousedown: Pointer3DEvent;
  /** Fired when the mouse enters this node; does not bubble */
  mouseenter: Pointer3DEvent;
  /** Fired when the mouse leaves this node; does not bubble */
  mouseleave: Pointer3DEvent;
  /** Fired while the mouse moves across this node */
  mousemove: Pointer3DEvent;
  /** Fired when the mouse moves off this node; bubbles, unlike `mouseleave` */
  mouseout: Pointer3DEvent;
  /** Fired when the mouse moves onto this node; bubbles, unlike `mouseenter` */
  mouseover: Pointer3DEvent;
  /** Fired when a mouse button is released over this node */
  mouseup: Pointer3DEvent;
  /** Fired when a mouse button that went down on this node is released anywhere else */
  mouseupoutside: Pointer3DEvent;
  /** Never fired — pixi's federated layer delivers no pointer cancellation; kept for 2D parity */
  pointercancel: Pointer3DEvent;
  /** Fired when a pointer goes down on this node — mouse, touch or pen alike */
  pointerdown: Pointer3DEvent;
  /** Fired when a pointer enters this node; does not bubble */
  pointerenter: Pointer3DEvent;
  /** Fired when a pointer leaves this node; does not bubble */
  pointerleave: Pointer3DEvent;
  /** Fired while a pointer moves across this node */
  pointermove: Pointer3DEvent;
  /** Fired when a pointer moves off this node; bubbles, unlike `pointerleave` */
  pointerout: Pointer3DEvent;
  /** Fired when a pointer moves onto this node; bubbles, unlike `pointerenter` */
  pointerover: Pointer3DEvent;
  /** Fired when a pointer completes a tap on this node — the pointer-type-agnostic `click` / `tap` */
  pointertap: Pointer3DEvent;
  /** Fired when a pointer is released over this node */
  pointerup: Pointer3DEvent;
  /** Fired when a pointer that went down on this node is released anywhere else */
  pointerupoutside: Pointer3DEvent;
  /** Fired when a right-click completes on this node */
  rightclick: Pointer3DEvent;
  /** Fired when the right mouse button goes down over this node */
  rightdown: Pointer3DEvent;
  /** Fired when the right mouse button is released over this node */
  rightup: Pointer3DEvent;
  /** Fired when the right mouse button that went down on this node is released anywhere else */
  rightupoutside: Pointer3DEvent;
  /** Fired when a touch completes a tap on this node */
  tap: Pointer3DEvent;
  /** Never fired — pixi's federated layer delivers no touch cancellation; kept for 2D parity */
  touchcancel: Pointer3DEvent;
  /** Fired when a touch lifts off this node */
  touchend: Pointer3DEvent;
  /** Fired when a touch that started on this node lifts off anywhere else */
  touchendoutside: Pointer3DEvent;
  /** Fired while a touch moves across this node */
  touchmove: Pointer3DEvent;
  /** Fired when a touch lands on this node */
  touchstart: Pointer3DEvent;
  /** Fired when the wheel turns while the pointer is over this node */
  wheel: Wheel3DEvent;
};

/**
 * The move events an interactive {@link Container3D} hears wherever the pointer is
 *
 * Fan-out notifications sent to every interactive node on any pointer move over the canvas.
 * As in pixi.js's `GlobalFederatedEventMap` there is no capture variant. The 3D fields carry the
 * View's pick for that move — not the node being notified — and read as a miss when the ray hit
 * nothing.
 * @example
 * ```ts
 * // Drag a mesh along the ground plane, even once the pointer leaves it
 * mesh.eventMode = 'static';
 * mesh.on('globalpointermove', (e) => {
 *   const hit = dragging && view3d.screenToWorld(e.global, ground);
 *   if (hit) mesh.position.copyFrom(hit);
 * });
 * ```
 * @see {@link EventBoundary3D#enableGlobalMoveEvents} To turn the fan-out off for a View.
 * @category events
 * @standard
 */
export type GlobalFederatedEventMap3D = {
  /** Fired on every mouse move over the canvas, wherever the pointer is */
  globalmousemove: Pointer3DEvent;
  /** Fired on every pointer move over the canvas, whether or not the pointer is over this node */
  globalpointermove: Pointer3DEvent;
  /** Fired on every touch move over the canvas, wherever the touch is */
  globaltouchmove: Pointer3DEvent;
};

/**
 * Emitter signatures for the 3D event set, including the `${type}capture` keys fired during the capture phase
 *
 * The 3D counterpart of pixi.js's `FederatedEventEmitterTypes`. Merged into `Container3DEvents`
 * through the `PixiMixins.Container3DEvents` hook, which is what types `container.on(...)` payloads.
 * @interface
 * @internal
 */
export type FederatedEventEmitterTypes3D = {
  [K in keyof FederatedEventMap3D as K | `${K}capture`]: [event: FederatedEventMap3D[K]];
} & {
  [K in keyof GlobalFederatedEventMap3D]: [event: GlobalFederatedEventMap3D[K]];
};
