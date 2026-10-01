import type { FederatedPointerEvent, FederatedWheelEvent, PointData } from 'pixi.js';
import { definedProps, EventEmitter, Ticker, UPDATE_PRIORITY } from 'pixi.js';

import type { Matrix4 } from '../../math/matrix/Matrix4';
import { Quaternion } from '../../math/rotation/Quaternion';
import { Plane } from '../../math/shapes/Plane';
import { Ray } from '../../math/shapes/Ray';
import { Spherical } from '../../math/shapes/Spherical';
import { clamp } from '../../math/utils/clamp';
import type { PointData3D } from '../../math/vector/PointData3D';
import { Vector2 } from '../../math/vector/Vector2';
import { Vector3 } from '../../math/vector/Vector3';
import type { Camera3D } from '../../scene/cameras/Camera3D';
import type { View3D } from '../../scene/View3D';

/**
 * What a mouse button does when dragged; assign one to each slot of {@link OrbitCamera#mouseButtons}
 * @example
 * ```ts
 * leftButtonSelect.onchange = () => {
 *   orbit.mouseButtons.left = leftButtonSelect.value as OrbitMouseAction;
 * };
 * ```
 * @category extras:camera
 * @standard
 */
export type OrbitMouseAction = 'rotate' | 'zoom' | 'pan' | 'none';

/**
 * What a touch gesture does; assign one to each slot of {@link OrbitCamera#touches}
 *
 * The two-finger combos pinch to zoom while dragging the midpoint pans or rotates.
 * @example
 * ```ts
 * const twoFingers: OrbitTouchAction = mapMode ? 'zoom-pan' : 'zoom-rotate';
 *
 * orbit.touches.two = twoFingers;
 * ```
 * @category extras:camera
 * @standard
 */
export type OrbitTouchAction = 'rotate' | 'pan' | 'zoom-pan' | 'zoom-rotate' | 'none';

/**
 * Mouse-button action assignments for {@link OrbitCamera}
 *
 * Holding ctrl, meta or shift swaps a button's `'rotate'` and `'pan'`.
 * @example
 * ```ts
 * const cadButtons: OrbitMouseButtons = { left: 'none', middle: 'rotate', right: 'pan' };
 *
 * Object.assign(orbit.mouseButtons, cadButtons);
 * ```
 * @category extras:camera
 * @standard
 */
export interface OrbitMouseButtons {
  /**
   * Action for the left mouse button
   * @default 'rotate'
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, mouseButtons: { left: 'pan', right: 'rotate' } });
   * ```
   */
  left: OrbitMouseAction;
  /**
   * Action for the middle mouse button
   * @default 'zoom'
   * @example
   * ```ts
   * orbit.mouseButtons.middle = 'pan';
   * ```
   */
  middle: OrbitMouseAction;
  /**
   * Action for the right mouse button
   * @default 'pan'
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, mouseButtons: { right: 'none' }, preventContextMenu: false });
   * ```
   */
  right: OrbitMouseAction;
}

/**
 * Touch-gesture action assignments for {@link OrbitCamera}
 * @example
 * ```ts
 * const mapTouches: OrbitTouches = { one: 'pan', two: 'zoom-rotate' };
 *
 * Object.assign(orbit.touches, mapTouches);
 * ```
 * @category extras:camera
 * @standard
 */
export interface OrbitTouches {
  /**
   * Action for a single-finger drag
   * @default 'rotate'
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, touches: { one: 'pan' } });
   * ```
   */
  one: OrbitTouchAction;
  /**
   * Action for a two-finger gesture
   * @default 'zoom-pan'
   * @example
   * ```ts
   * orbit.touches.two = 'zoom-rotate';
   * ```
   */
  two: OrbitTouchAction;
}

/**
 * Constructor options for {@link OrbitCamera}
 *
 * Every field but `view` has a default; pass only what you need. Every option is also a
 * property on the instance, and all but `view` can be changed at runtime.
 * @example
 * ```ts
 * const turntable: Omit<OrbitCameraOptions, 'view'> = {
 *   enablePan: false,
 *   autoRotate: true,
 *   maxPolarAngle: Math.PI / 2,
 * };
 * const orbit = new OrbitCamera({ view: view3d, ...turntable });
 * ```
 * @see {@link OrbitCamera} For the constructed controller.
 * @category extras:camera
 * @standard
 */
export interface OrbitCameraOptions {
  /**
   * The {@link View3D} to drive
   *
   * The controller moves `view.camera` and listens for pointer and wheel events on the
   * View itself, so input follows the View's 2D placement, `hitArea`, and event
   * propagation like any other pixi container.
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d });
   * ```
   */
  view: View3D;
  /**
   * World-space point to orbit around; `(0, 0, 0)` when omitted
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, target: { x: 0, y: 1.2, z: 0 } });
   * ```
   */
  target?: PointData3D;
  /**
   * Whether the controller responds to input; {@link OrbitCamera#enabled} covers what keeps running
   * @default true
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, enabled: false });
   *
   * startButton.on('pointertap', () => (orbit.enabled = true));
   * ```
   */
  enabled?: boolean;
  /**
   * Run {@link OrbitCamera#update | update()} from `Ticker.shared` every frame
   *
   * Set `false` to drive updates yourself; {@link OrbitCamera#autoUpdate} says when that helps.
   * @default true
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, autoUpdate: false });
   *
   * app.ticker.add((ticker) => orbit.update(ticker));
   * ```
   */
  autoUpdate?: boolean;
  /**
   * Minimum distance from `target`
   * @default 0
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, minDistance: 2 });
   * ```
   */
  minDistance?: number;
  /**
   * Maximum distance from `target`
   * @default Infinity
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, maxDistance: 20 });
   * ```
   */
  maxDistance?: number;
  /**
   * Minimum camera zoom (orthographic only)
   * @default 0
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, minZoom: 0.5 });
   * ```
   */
  minZoom?: number;
  /**
   * Maximum camera zoom (orthographic only)
   * @default Infinity
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, maxZoom: 4 });
   * ```
   */
  maxZoom?: number;
  /**
   * Smallest {@link OrbitCamera#polarAngle | polar angle} the camera can reach, in radians
   * @default 0
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, minPolarAngle: Math.PI / 6 });
   * ```
   */
  minPolarAngle?: number;
  /**
   * Largest {@link OrbitCamera#polarAngle | polar angle} the camera can reach, in radians
   * @default Math.PI
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, maxPolarAngle: Math.PI / 2 });
   * ```
   */
  maxPolarAngle?: number;
  /**
   * Smallest {@link OrbitCamera#azimuthAngle | azimuth} the camera can reach, in radians;
   * {@link OrbitCamera#minAzimuthAngle} covers how the pair of limits applies
   * @default -Infinity
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, minAzimuthAngle: -Math.PI / 4, maxAzimuthAngle: Math.PI / 4 });
   * ```
   */
  minAzimuthAngle?: number;
  /**
   * Largest {@link OrbitCamera#azimuthAngle | azimuth} the camera can reach, in radians
   * @default Infinity
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, minAzimuthAngle: 0, maxAzimuthAngle: Math.PI / 2 });
   * ```
   */
  maxAzimuthAngle?: number;
  /**
   * Ease camera motion out after input stops; {@link OrbitCamera#enableDamping} has the details
   * @default false
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, enableDamping: true });
   * ```
   */
  enableDamping?: boolean;
  /**
   * Share of the remaining motion applied each update while `enableDamping` is on
   * @default 0.05
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, enableDamping: true, dampingFactor: 0.1 });
   * ```
   */
  dampingFactor?: number;
  /**
   * Whether the wheel, pinches and any button set to `'zoom'` zoom the camera
   * @default true
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, enableZoom: false });
   * ```
   */
  enableZoom?: boolean;
  /**
   * Multiplier on zoom input from the wheel, pinches and zoom-button drags
   * @default 1
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, zoomSpeed: 0.5 });
   * ```
   */
  zoomSpeed?: number;
  /**
   * Whether drags rotate the camera
   * @default true
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, enableRotate: false });
   * ```
   */
  enableRotate?: boolean;
  /**
   * Multiplier on rotate drags
   * @default 1
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, rotateSpeed: 0.5 });
   * ```
   */
  rotateSpeed?: number;
  /**
   * Whether drags pan the camera
   * @default true
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, enablePan: false });
   * ```
   */
  enablePan?: boolean;
  /**
   * Multiplier on pan drags
   * @default 1
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, panSpeed: 2 });
   * ```
   */
  panSpeed?: number;
  /**
   * `true` pans in the screen's plane; `false` pans across the plane at right angles to
   * {@link OrbitCamera#up}, so vertical drags move over the ground like a map
   * @default true
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, screenSpacePanning: false });
   * ```
   */
  screenSpacePanning?: boolean;
  /**
   * Zoom toward the point under the pointer instead of the target; {@link OrbitCamera#zoomToCursor}
   * has the details
   * @default false
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, zoomToCursor: true });
   * ```
   */
  zoomToCursor?: boolean;
  /**
   * Orbit around the target on its own whenever no gesture is in progress
   * @default false
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, autoRotate: true });
   * ```
   */
  autoRotate?: boolean;
  /**
   * Auto-rotate speed in revolutions per minute; negative values turn the other way
   * @default 2
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, autoRotate: true, autoRotateSpeed: 0.5 });
   * ```
   */
  autoRotateSpeed?: number;
  /**
   * Mouse-button action assignments, merged over the defaults
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, mouseButtons: { left: 'pan', right: 'rotate' } });
   * ```
   */
  mouseButtons?: Partial<OrbitMouseButtons>;
  /**
   * Touch-gesture action assignments, merged over the defaults
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, touches: { one: 'pan', two: 'zoom-rotate' } });
   * ```
   */
  touches?: Partial<OrbitTouches>;
  /**
   * Keep the browser's context menu from opening over the View, so a right-button drag or a
   * ctrl + click on macOS doesn't open it
   *
   * The View's `hitArea` bounds it like any other pointer event, and the menu still opens while
   * `enabled` is `false`. On Windows the menu opens on release, so a right-button drag that ends
   * outside the View still opens it.
   * @default true
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, preventContextMenu: false, mouseButtons: { right: 'none' } });
   * ```
   */
  preventContextMenu?: boolean;
  /**
   * World-space up axis the orbit turns around; `(0, 1, 0)` when omitted
   * @example
   * ```ts
   * const orbit = new OrbitCamera({ view: view3d, up: { x: 0, y: 0, z: 1 } });
   * ```
   */
  up?: PointData3D;
}

type Gesture =
  | 'none'
  | 'rotate'
  | 'zoom'
  | 'pan'
  | 'touch-rotate'
  | 'touch-pan'
  | 'touch-zoom-pan'
  | 'touch-zoom-rotate';

const _EPS = 0.000001;
const _twoPI = 2 * Math.PI;
/**
 * Cosine of 70°: zoom-to-cursor without screen-space panning moves the target to where the view's
 * centre ray meets the target's ground plane, but not when the ray is within 20° of that plane,
 * where the hit point runs off toward the horizon
 */
const _TILT_LIMIT = Math.cos(70 * (Math.PI / 180));
const _worldUp = new Vector3(0, 1, 0);

const _v = new Vector3();
const _plane = new Plane();
const _ray = new Ray();
const _zoomCamPos = new Vector3();
const _rayOrigin = new Vector3();
const _rayDir = new Vector3();

/**
 * Orbit / zoom / pan input controller for a {@link View3D}'s camera
 *
 * Rotate with the left mouse button or one finger, zoom with the wheel, middle button, or
 * a two-finger pinch, and pan with the right button, ctrl/meta/shift + left button, or a
 * two-finger drag. Supports inertial damping, zoom-to-cursor, axis clamps, auto-orbit, and
 * a save / reset of camera state.
 *
 * Input arrives through the View's federated pointer and wheel events, so a 3D node that
 * stops propagation keeps the camera still, and the View's `hitArea` bounds the
 * interactive region. Updates run from `Ticker.shared` by default; set
 * {@link OrbitCamera#autoUpdate | autoUpdate} to `false` and call
 * {@link OrbitCamera#update | update()} yourself to drive it from your own loop.
 * @example
 * ```ts
 * import { OrbitCamera } from '@pixi/3d/extras';
 *
 * const orbit = new OrbitCamera({
 *   view: view3d,
 *   target: { x: 0, y: 1, z: 0 },
 *   enableDamping: true,
 *   minDistance: 2,
 *   maxDistance: 20,
 * });
 *
 * orbit.on('change', () => console.log('camera moved'));
 *
 * // On teardown:
 * orbit.destroy();
 * ```
 * @remarks
 * - Pixi registers its wheel listener as passive, so wheel zoom can't stop the page from
 *   scrolling. Keep the canvas from overflowing its container instead.
 * - The controller blocks the browser's context menu over the View so the right button can
 *   pan. Set {@link OrbitCamera#preventContextMenu | preventContextMenu} to `false` to keep
 *   the menu.
 * @see {@link OrbitCameraOptions} For all constructor options.
 * @see {@link FPSCamera} For a first-person walker controller.
 * @see {@link Camera3D} For the underlying camera.
 * @category extras:camera
 * @standard
 */
export class OrbitCamera extends EventEmitter<{
  /**
   * A pointer or wheel gesture started
   * @example
   * ```ts
   * orbit.on('start', () => (view3d.cursor = 'grabbing'));
   * ```
   */
  start: [];
  /**
   * A pointer or wheel gesture ended
   * @example
   * ```ts
   * orbit.on('end', () => (view3d.cursor = 'grab'));
   * ```
   */
  end: [];
  /**
   * The camera or target moved
   * @example
   * ```ts
   * await app.init({ autoStart: false });
   * orbit.on('change', () => app.render());
   * ```
   */
  change: [];
}> {
  /**
   * Default {@link OrbitCameraOptions} merged under every constructor call
   *
   * `new OrbitCamera(opts)` resolves as `{ ...OrbitCamera.defaultOptions, ...opts }`.
   * Mutate to change defaults process-wide.
   * @example
   * ```ts
   * OrbitCamera.defaultOptions.enableDamping = true;
   * ```
   */
  public static defaultOptions: Partial<Omit<OrbitCameraOptions, 'view'>> = {
    enabled: true,
    autoUpdate: true,
    minDistance: 0,
    maxDistance: Infinity,
    minZoom: 0,
    maxZoom: Infinity,
    minPolarAngle: 0,
    maxPolarAngle: Math.PI,
    minAzimuthAngle: -Infinity,
    maxAzimuthAngle: Infinity,
    enableDamping: false,
    dampingFactor: 0.05,
    enableZoom: true,
    zoomSpeed: 1,
    enableRotate: true,
    rotateSpeed: 1,
    enablePan: true,
    panSpeed: 1,
    screenSpacePanning: true,
    zoomToCursor: false,
    autoRotate: false,
    autoRotateSpeed: 2,
    mouseButtons: { left: 'rotate', middle: 'zoom', right: 'pan' },
    touches: { one: 'rotate', two: 'zoom-pan' },
    preventContextMenu: true,
  };

  /**
   * The {@link View3D} this controller listens on and whose camera it drives
   * @example
   * ```ts
   * orbit.view.hitArea = new Rectangle(0, 0, 400, 300);
   * ```
   */
  public readonly view: View3D;

  /**
   * Whether the controller responds to input
   *
   * It gates input only. {@link OrbitCamera#update | update()} keeps running, so damping and
   * auto-rotate carry on and every update turns the camera back toward the target. Turn
   * {@link OrbitCamera#autoUpdate | autoUpdate} off as well before aiming the camera yourself.
   * @example
   * ```ts
   * function setMode(mode: 'inspect' | 'build'): void {
   *   orbit.enabled = mode === 'inspect';
   * }
   * ```
   */
  public enabled: boolean;

  /**
   * World-space point the camera orbits; mutate freely, and the change shows on the next update
   * @example
   * ```ts
   * model.on('pointertap', (event) => {
   *   if (event.hit3D) orbit.target.copyFrom(event.hit3D.point);
   * });
   * ```
   */
  public readonly target = new Vector3();

  /**
   * Minimum distance from `target`
   * @example
   * ```ts
   * orbit.minDistance = mesh.boundingSphere.radius * 1.5;
   * ```
   */
  public minDistance = 0;
  /**
   * Maximum distance from `target`
   * @example
   * ```ts
   * orbit.maxDistance = mesh.boundingSphere.radius * 10;
   * ```
   */
  public maxDistance = 0;

  /**
   * Smallest `camera.zoom` an orthographic camera can reach; a perspective camera zooms by distance
   * instead
   * @example
   * ```ts
   * view3d.camera.mode = 'orthographic';
   * orbit.minZoom = 0.5;
   * ```
   */
  public minZoom = 0;
  /**
   * Largest `camera.zoom` an orthographic camera can reach
   * @example
   * ```ts
   * view3d.camera.mode = 'orthographic';
   * orbit.maxZoom = 4;
   * ```
   */
  public maxZoom = 0;

  /**
   * Smallest {@link OrbitCamera#polarAngle | polar angle} the camera can reach, in radians
   * @example
   * ```ts
   * orbit.minPolarAngle = Math.PI / 6;
   * ```
   */
  public minPolarAngle = 0;
  /**
   * Largest {@link OrbitCamera#polarAngle | polar angle} the camera can reach, in radians
   * @example
   * ```ts
   * orbit.maxPolarAngle = Math.PI / 2;
   * ```
   */
  public maxPolarAngle = 0;

  /**
   * Smallest {@link OrbitCamera#azimuthAngle | azimuth} the camera can reach, in radians
   *
   * The azimuth limits apply only while both are finite. They wrap, so a minimum greater than the
   * maximum allows the arc that passes through ±π.
   * @example
   * ```ts
   * orbit.minAzimuthAngle = -Math.PI / 4;
   * orbit.maxAzimuthAngle = Math.PI / 4;
   * ```
   */
  public minAzimuthAngle = 0;
  /**
   * Largest {@link OrbitCamera#azimuthAngle | azimuth} the camera can reach, in radians;
   * {@link OrbitCamera#minAzimuthAngle} covers how the pair of limits applies
   * @example
   * ```ts
   * orbit.minAzimuthAngle = (3 * Math.PI) / 4;
   * orbit.maxAzimuthAngle = -(3 * Math.PI) / 4;
   * ```
   */
  public maxAzimuthAngle = 0;

  /**
   * Ease camera motion out after input stops, instead of halting with the pointer
   *
   * The glide happens in {@link OrbitCamera#update | update()}, so it needs
   * {@link OrbitCamera#autoUpdate | autoUpdate} on, or your own update call every frame.
   * @example
   * ```ts
   * smoothCameraCheckbox.onchange = () => (orbit.enableDamping = smoothCameraCheckbox.checked);
   * ```
   */
  public enableDamping: boolean;
  /**
   * Share of the remaining motion applied each update while `enableDamping` is on; lower values
   * glide longer
   *
   * It applies per update, not per second, so the glide is shorter at higher frame rates.
   * @example
   * ```ts
   * orbit.enableDamping = true;
   * orbit.dampingFactor = 0.15;
   * ```
   */
  public dampingFactor = 0;

  /**
   * Whether the wheel, pinches and any button set to `'zoom'` zoom the camera;
   * {@link OrbitCamera#zoom | zoom()} works either way
   * @example
   * ```ts
   * orbit.enableZoom = false;
   * ```
   */
  public enableZoom: boolean;
  /**
   * Multiplier on zoom input from the wheel, pinches and zoom-button drags
   * @example
   * ```ts
   * orbit.zoomSpeed = 0.5;
   * ```
   */
  public zoomSpeed = 0;

  /**
   * Whether drags rotate the camera; {@link OrbitCamera#rotate | rotate()} works either way
   * @example
   * ```ts
   * orbit.enableRotate = false;
   * orbit.mouseButtons.left = 'pan';
   * ```
   */
  public enableRotate: boolean;
  /**
   * Multiplier on rotate drags
   * @example
   * ```ts
   * orbit.rotateSpeed = settings.mouseSensitivity;
   * ```
   */
  public rotateSpeed = 0;

  /**
   * Whether drags pan the camera; {@link OrbitCamera#pan | pan()} works either way
   * @example
   * ```ts
   * orbit.enablePan = false;
   * ```
   */
  public enablePan: boolean;
  /**
   * Multiplier on pan drags
   * @example
   * ```ts
   * orbit.panSpeed = 2;
   * ```
   */
  public panSpeed = 0;
  /**
   * `true` pans in the screen's plane; `false` pans across the plane at right angles to
   * {@link OrbitCamera#up}, so vertical drags move over the ground like a map
   * @example
   * ```ts
   * orbit.screenSpacePanning = false;
   * ```
   */
  public screenSpacePanning: boolean;

  /**
   * Zoom toward the point under the pointer, or between the fingers of a pinch, instead of toward
   * the target
   *
   * The target follows the zoom, so later orbits pivot near what you zoomed to. With
   * {@link OrbitCamera#screenSpacePanning | screenSpacePanning} on it moves along the view
   * direction; with it off it moves to where the view's centre ray meets the plane through the
   * target at right angles to `up`.
   * @example
   * ```ts
   * orbit.zoomToCursor = true;
   * ```
   */
  public zoomToCursor: boolean;

  /**
   * Orbit around the target on its own whenever no gesture is in progress
   * @example
   * ```ts
   * let idleTimer: ReturnType<typeof setTimeout>;
   *
   * orbit.on('start', () => {
   *   clearTimeout(idleTimer);
   *   orbit.autoRotate = false;
   * });
   * orbit.on('end', () => {
   *   idleTimer = setTimeout(() => (orbit.autoRotate = true), 3000);
   * });
   * ```
   */
  public autoRotate: boolean;
  /**
   * Auto-rotate speed in revolutions per minute; negative values turn the other way
   * @example
   * ```ts
   * orbit.autoRotateSpeed = -1;
   * ```
   */
  public autoRotateSpeed = 0;

  /**
   * Mouse-button action assignments; change a slot to remap that button
   *
   * Holding ctrl, meta or shift swaps a button's `'rotate'` and `'pan'`.
   * @example
   * ```ts
   * orbit.mouseButtons.left = 'pan';
   * orbit.mouseButtons.right = 'rotate';
   * ```
   */
  public readonly mouseButtons: OrbitMouseButtons;
  /**
   * Touch-gesture action assignments; change a slot to remap that gesture
   * @example
   * ```ts
   * orbit.touches.one = 'pan';
   * ```
   */
  public readonly touches: OrbitTouches;

  /**
   * Whether the browser's context menu is kept from opening over the View;
   * {@link OrbitCameraOptions#preventContextMenu} covers where it still opens
   * @example
   * ```ts
   * orbit.mouseButtons.right = 'none';
   * orbit.preventContextMenu = false;
   * ```
   */
  public preventContextMenu: boolean;

  private readonly _up = new Vector3(0, 1, 0);
  /**
   * Rotates {@link OrbitCamera#up} onto +Y, so the spherical math always runs in a Y-up frame;
   * `_quatInverse` rotates back
   */
  private readonly _quat = new Quaternion();
  private readonly _quatInverse = new Quaternion();

  private _autoUpdate = false;
  private _gesture: Gesture = 'none';

  private readonly _savedTarget = new Vector3();
  private readonly _savedPosition = new Vector3();
  private _savedZoom = 1;

  private readonly _lastPosition = new Vector3();
  private readonly _lastQuaternion = new Quaternion();
  private readonly _lastTarget = new Vector3();

  private readonly _spherical = new Spherical();
  private readonly _sphericalDelta = new Spherical();

  private _scale = 1;
  private readonly _panOffset = new Vector3();

  private readonly _rotateStart = new Vector2();
  private readonly _rotateEnd = new Vector2();
  private readonly _rotateDelta = new Vector2();

  private readonly _panStart = new Vector2();
  private readonly _panEnd = new Vector2();
  private readonly _panDelta = new Vector2();

  private _pinchStart = 0;
  private readonly _pinchCenter = new Vector2();
  private _zoomStartY = 0;

  private readonly _zoomDirection = new Vector3();
  private _performCursorZoom = false;

  /** Pressed pointer ids, in press order */
  private readonly _pointers: number[] = [];
  /** Last View-local position of each pressed touch */
  private readonly _pointerPositions = new Map<number, Vector2>();
  private readonly _local = new Vector2();

  /**
   * Creates a new `OrbitCamera` bound to `options.view`
   *
   * Listeners are wired immediately; call {@link OrbitCamera#destroy | destroy()} to
   * remove them.
   * @param options - construction options; see {@link OrbitCameraOptions}
   */
  constructor(options: OrbitCameraOptions) {
    super();

    const opts = { ...OrbitCamera.defaultOptions, ...definedProps(options) };

    this.view = options.view;
    this.enabled = opts.enabled!;
    this.minDistance = opts.minDistance!;
    this.maxDistance = opts.maxDistance!;
    this.minZoom = opts.minZoom!;
    this.maxZoom = opts.maxZoom!;
    this.minPolarAngle = opts.minPolarAngle!;
    this.maxPolarAngle = opts.maxPolarAngle!;
    this.minAzimuthAngle = opts.minAzimuthAngle!;
    this.maxAzimuthAngle = opts.maxAzimuthAngle!;
    this.enableDamping = opts.enableDamping!;
    this.dampingFactor = opts.dampingFactor!;
    this.enableZoom = opts.enableZoom!;
    this.zoomSpeed = opts.zoomSpeed!;
    this.enableRotate = opts.enableRotate!;
    this.rotateSpeed = opts.rotateSpeed!;
    this.enablePan = opts.enablePan!;
    this.panSpeed = opts.panSpeed!;
    this.screenSpacePanning = opts.screenSpacePanning!;
    this.zoomToCursor = opts.zoomToCursor!;
    this.autoRotate = opts.autoRotate!;
    this.autoRotateSpeed = opts.autoRotateSpeed!;
    this.mouseButtons = { ...OrbitCamera.defaultOptions.mouseButtons, ...options.mouseButtons } as OrbitMouseButtons;
    this.touches = { ...OrbitCamera.defaultOptions.touches, ...options.touches } as OrbitTouches;
    this.preventContextMenu = opts.preventContextMenu!;

    if (opts.target) this.target.copyFrom(opts.target);
    this.up = opts.up ?? _worldUp;

    this.saveState();

    const view = this.view;

    view.on('pointerdown', this._onPointerDown);
    view.on('globalpointermove', this._onPointerMove);
    view.on('pointerup', this._onPointerUp);
    view.on('pointerupoutside', this._onPointerUp);
    view.on('pointercancel', this._onPointerUp);
    view.on('wheel', this._onWheel);
    view.on('contextmenu', this._onContextMenu);

    this.autoUpdate = opts.autoUpdate!;

    this.update();
  }

  /**
   * The {@link Camera3D} being driven, always `view.camera`
   *
   * Move it yourself and the controller adopts the new position, within its limits, on its next
   * update. It always turns the camera to face the target.
   * @example
   * ```ts
   * orbit.camera.position.set(0, 2, 6);
   * orbit.update();
   * ```
   */
  public get camera(): Camera3D {
    return this.view.camera;
  }

  /**
   * World-space up axis the orbit turns around
   *
   * Assign a new value to change it, and the camera settles on the next update. Changing the
   * returned vector in place doesn't rebuild the orbit frame.
   * @example
   * ```ts
   * orbit.up = { x: 0, y: 0, z: 1 };
   * ```
   */
  public get up(): Vector3 {
    return this._up;
  }

  /**
   * Sets the up axis and rebuilds the orbit frame around it
   * @param value - Direction to treat as up; normalized on assignment
   */
  public set up(value: PointData3D) {
    this._up.copyFrom(value).normalize();
    this._quat.setFromUnitVectors(this._up, _worldUp);
    this._quatInverse.copyFrom(this._quat).inverse();
  }

  /**
   * Whether {@link OrbitCamera#update | update()} runs from `Ticker.shared` every frame
   *
   * Turn off to drive updates from your own loop. A default pixi `Application` renders from its
   * own ticker, not `Ticker.shared`, so ticker-driven motion (damping and auto-rotate) usually lands
   * after the frame is drawn. Updating from `app.ticker` keeps it in step with the render.
   * @example
   * ```ts
   * orbit.autoUpdate = false;
   * app.ticker.add((ticker) => orbit.update(ticker));
   * ```
   */
  public get autoUpdate(): boolean {
    return this._autoUpdate;
  }

  /**
   * Connects to or disconnects from `Ticker.shared`
   * @param value - Whether to run `update()` every frame
   */
  public set autoUpdate(value: boolean) {
    if (value === this._autoUpdate) return;

    this._autoUpdate = value;

    if (value) {
      Ticker.shared.add(this._onTick, undefined, UPDATE_PRIORITY.HIGH);
    } else {
      Ticker.shared.remove(this._onTick);
    }
  }

  /**
   * Current polar angle in radians, measured from `up`: 0 puts the camera straight above the
   * target, π/2 level with it and π straight below
   * @example
   * ```ts
   * orbit.on('change', () => (floorGrid.visible = orbit.polarAngle < Math.PI / 2));
   * ```
   */
  public get polarAngle(): number {
    return this._spherical.phi;
  }

  /**
   * Current azimuth angle in radians, around `up`: 0 puts the camera on the target's +Z side, and
   * positive angles move it toward +X
   * @example
   * ```ts
   * orbit.on('change', () => (compassNeedle.rotation = orbit.azimuthAngle));
   * ```
   */
  public get azimuthAngle(): number {
    return this._spherical.theta;
  }

  /**
   * Current world-space distance from the camera to {@link OrbitCamera#target | target}
   * @example
   * ```ts
   * orbit.on('change', () => (labels.visible = orbit.distance < 15));
   * ```
   */
  public get distance(): number {
    return _v.copyFrom(this.camera.position).distanceTo(this.target);
  }

  /**
   * Remove every listener, stop auto-updating, and drop event subscribers
   *
   * The View and camera are owned by the caller and are left intact, so a stray
   * {@link OrbitCamera#update | update()} after destroy is harmless.
   * @example
   * ```ts
   * orbit.destroy();
   * const walker = new FPSCamera({ view: view3d, position: { x: 0, y: 1.7, z: 5 } });
   * ```
   */
  public destroy(): void {
    this.autoUpdate = false;

    const view = this.view;

    view.off('pointerdown', this._onPointerDown);
    view.off('globalpointermove', this._onPointerMove);
    view.off('pointerup', this._onPointerUp);
    view.off('pointerupoutside', this._onPointerUp);
    view.off('pointercancel', this._onPointerUp);
    view.off('wheel', this._onWheel);
    view.off('contextmenu', this._onContextMenu);

    this._pointers.length = 0;
    this._pointerPositions.clear();
    this._gesture = 'none';

    this.removeAllListeners();
  }

  /**
   * Snapshot `target`, `camera.position`, and `camera.zoom` for a later {@link OrbitCamera#reset | reset()}
   * @example
   * ```ts
   * saveViewButton.on('pointertap', () => orbit.saveState());
   * ```
   */
  public saveState(): void {
    this._savedTarget.copyFrom(this.target);
    this._savedPosition.copyFrom(this.camera.position);
    this._savedZoom = this.camera.zoom;
  }

  /**
   * Restore the last {@link OrbitCamera#saveState | saveState()} snapshot (the construction pose by default)
   * @example
   * ```ts
   * resetViewButton.on('pointertap', () => orbit.reset());
   * ```
   */
  public reset(): void {
    this.target.copyFrom(this._savedTarget);
    this.camera.position.copyFrom(this._savedPosition);
    this.camera.zoom = this._savedZoom;

    this.emit('change');
    this.update();
    this._gesture = 'none';
  }

  /**
   * Orbit around `target` by the given angles and apply the update
   *
   * It works whatever `enabled` and `enableRotate` say, since those only gate input. With damping
   * on, the turn is spread over the following updates.
   * @example
   * ```ts
   * window.addEventListener('keydown', (event) => {
   *   if (event.code === 'ArrowLeft') orbit.rotate(-0.1, 0);
   *   if (event.code === 'ArrowRight') orbit.rotate(0.1, 0);
   * });
   * ```
   * @param azimuth - Angle around `up` in radians; positive moves the camera the way a rightward
   *   drag does
   * @param polar - Angle toward `up` in radians; positive raises the camera over the target, as a
   *   downward drag does
   */
  public rotate(azimuth: number, polar: number): void {
    this._sphericalDelta.theta -= azimuth;
    this._sphericalDelta.phi -= polar;
    this.update();
  }

  /**
   * Pan as a drag of `(deltaX, deltaY)` View pixels would, and apply the update
   *
   * Positive values move the scene right and down, following the drag. It works whatever
   * `enabled` and `enablePan` say, and `panSpeed` doesn't scale it.
   * @example
   * ```ts
   * window.addEventListener('keydown', (event) => {
   *   if (event.code === 'KeyA') orbit.pan(40, 0);
   *   if (event.code === 'KeyD') orbit.pan(-40, 0);
   * });
   * ```
   * @param deltaX - Horizontal drag in View pixels
   * @param deltaY - Vertical drag in View pixels
   */
  public pan(deltaX: number, deltaY: number): void {
    this._pan(deltaX, deltaY);
    this.update();
  }

  /**
   * Zoom by a multiplicative `factor` toward the target and apply the update
   *
   * It works whatever `enabled` and `enableZoom` say, and `zoomSpeed` doesn't scale it.
   * @example
   * ```ts
   * zoomInButton.on('pointertap', () => orbit.zoom(1.25));
   * zoomOutButton.on('pointertap', () => orbit.zoom(0.8));
   * ```
   * @param factor - `> 1` zooms in (camera moves closer), `< 1` zooms out
   */
  public zoom(factor: number): void {
    this._scale /= factor;
    this.update();
  }

  /**
   * Recompute the camera from the current orbit state, applying damping and auto-rotate
   * as enabled
   *
   * Runs every frame while {@link OrbitCamera#autoUpdate | autoUpdate} is on, and after
   * every input gesture. Call it yourself when driving the controller from your own loop.
   * @example
   * ```ts
   * orbit.autoUpdate = false;
   * app.ticker.add((ticker) => {
   *   if (orbit.update(ticker)) minimap.redraw();
   * });
   * ```
   * @param ticker - The ticker driving this update; supplies frame timing for auto-rotate.
   *   Omitted, one 60 fps frame is assumed.
   * @returns `true` when the camera changed enough to warrant a re-render
   */
  public update(ticker?: Ticker): boolean {
    const camera = this.camera;

    _v.copyFrom(camera.position).subtract(this.target);
    _v.applyQuaternion(this._quat);

    this._spherical.setFromPoint3D(_v);

    if (this.autoRotate && this._gesture === 'none') {
      const frames = ticker ? ticker.deltaTime : 1;

      this._sphericalDelta.theta -= (_twoPI / 3600) * this.autoRotateSpeed * frames;
    }

    if (this.enableDamping) {
      this._spherical.theta += this._sphericalDelta.theta * this.dampingFactor;
      this._spherical.phi += this._sphericalDelta.phi * this.dampingFactor;
    } else {
      this._spherical.theta += this._sphericalDelta.theta;
      this._spherical.phi += this._sphericalDelta.phi;
    }

    let min = this.minAzimuthAngle;
    let max = this.maxAzimuthAngle;

    if (isFinite(min) && isFinite(max)) {
      if (min < -Math.PI) min += _twoPI;
      else if (min > Math.PI) min -= _twoPI;

      if (max < -Math.PI) max += _twoPI;
      else if (max > Math.PI) max -= _twoPI;

      if (min <= max) {
        this._spherical.theta = clamp(this._spherical.theta, min, max);
      } else {
        this._spherical.theta =
          this._spherical.theta > (min + max) / 2
            ? Math.max(min, this._spherical.theta)
            : Math.min(max, this._spherical.theta);
      }
    }

    this._spherical.phi = clamp(this._spherical.phi, this.minPolarAngle, this.maxPolarAngle);
    this._spherical.makeSafe();

    if (this.enableDamping) {
      this.target.addScaledVector(this._panOffset, this.dampingFactor);
    } else {
      this.target.add(this._panOffset);
    }

    let zoomChanged = false;

    if ((this.zoomToCursor && this._performCursorZoom) || camera.mode === 'orthographic') {
      this._spherical.radius = this._clampDistance(this._spherical.radius);
    } else {
      const prevRadius = this._spherical.radius;

      this._spherical.radius = this._clampDistance(this._spherical.radius * this._scale);
      zoomChanged = prevRadius !== this._spherical.radius;
    }

    _v.setFromSpherical(this._spherical);
    _v.applyQuaternion(this._quatInverse);

    camera.position.set(this.target.x + _v.x, this.target.y + _v.y, this.target.z + _v.z);
    camera.lookAt(this.target);

    if (this.enableDamping) {
      this._sphericalDelta.theta *= 1 - this.dampingFactor;
      this._sphericalDelta.phi *= 1 - this.dampingFactor;
      this._panOffset.multiplyScalar(1 - this.dampingFactor);
    } else {
      this._sphericalDelta.set(0, 0, 0);
      this._panOffset.set(0, 0, 0);
    }

    if (this.zoomToCursor && this._performCursorZoom) {
      let newRadius: number;

      if (camera.mode === 'perspective') {
        const prevRadius = _v.magnitude();

        newRadius = this._clampDistance(prevRadius * this._scale);

        const radiusDelta = prevRadius - newRadius;

        camera.position.set(
          camera.position.x + this._zoomDirection.x * radiusDelta,
          camera.position.y + this._zoomDirection.y * radiusDelta,
          camera.position.z + this._zoomDirection.z * radiusDelta,
        );
        camera.lookAt(this.target);

        zoomChanged = !!radiusDelta;
      } else {
        const prevZoom = camera.zoom;

        camera.zoom = clamp(camera.zoom / this._scale, this.minZoom, this.maxZoom);
        zoomChanged = prevZoom !== camera.zoom;

        newRadius = _v.magnitude();
      }

      _zoomCamPos.copyFrom(camera.position);

      if (this.screenSpacePanning) {
        this.target.set(0, 0, -1).transformDirection(camera.worldTransform).multiplyScalar(newRadius).add(_zoomCamPos);
      } else {
        _rayOrigin.copyFrom(_zoomCamPos);
        _rayDir.set(0, 0, -1).transformDirection(camera.worldTransform);

        if (Math.abs(this._up.dot(_rayDir)) < _TILT_LIMIT) {
          camera.lookAt(this.target);
        } else {
          _plane.setFromNormalAndCoplanarPoint(this._up, this.target);

          const denom = _rayDir.dot(_plane.normal);

          if (Math.abs(denom) > _EPS) {
            const t = -(_rayOrigin.dot(_plane.normal) + _plane.constant) / denom;

            if (t >= 0) {
              this.target.copyFrom(_rayOrigin).addScaledVector(_rayDir, t);
            }
          }
        }
      }
    } else if (camera.mode === 'orthographic') {
      const prevZoom = camera.zoom;

      camera.zoom = clamp(camera.zoom / this._scale, this.minZoom, this.maxZoom);
      zoomChanged = prevZoom !== camera.zoom;
    }

    this._scale = 1;
    this._performCursorZoom = false;

    if (
      zoomChanged ||
      this._lastPosition.distanceToSquared(camera.position) > _EPS ||
      8 * (1 - this._lastQuaternion.dot(camera.quaternion)) > _EPS ||
      this._lastTarget.distanceToSquared(this.target) > _EPS
    ) {
      this._lastPosition.copyFrom(camera.position);
      this._lastQuaternion.copyFrom(camera.quaternion);
      this._lastTarget.copyFrom(this.target);

      this.emit('change');

      return true;
    }

    return false;
  }

  private readonly _onTick = (ticker: Ticker): void => {
    this.update(ticker);
  };

  /** Height in View pixels of the camera's viewport, the reference length for drag deltas */
  private _viewportHeight(): number {
    return this.view.height * this.camera.viewport.height;
  }

  private _viewportWidth(): number {
    return this.view.width * this.camera.viewport.width;
  }

  private _zoomScale(delta: number): number {
    return Math.pow(0.95, this.zoomSpeed * Math.abs(delta * 0.01));
  }

  private _rotateBy(deltaX: number, deltaY: number): void {
    const height = this._viewportHeight();

    this._sphericalDelta.theta -= (_twoPI * deltaX) / height;
    this._sphericalDelta.phi -= (_twoPI * deltaY) / height;
  }

  private _panLeft(distance: number, objectMatrix: Matrix4): void {
    _v.setFromMatrixColumn(objectMatrix, 0);
    _v.multiplyScalar(-distance);
    this._panOffset.add(_v);
  }

  private _panUp(distance: number, objectMatrix: Matrix4): void {
    if (this.screenSpacePanning) {
      _v.setFromMatrixColumn(objectMatrix, 1);
    } else {
      _v.setFromMatrixColumn(objectMatrix, 0);
      this._up.cross(_v, _v);
    }

    _v.multiplyScalar(distance);
    this._panOffset.add(_v);
  }

  private _pan(deltaX: number, deltaY: number): void {
    const camera = this.camera;
    const height = this._viewportHeight();

    if (camera.mode === 'perspective') {
      _v.copyFrom(camera.position).subtract(this.target);

      const targetDistance = _v.magnitude() * Math.tan((camera.fov / 2) * (Math.PI / 180));

      this._panLeft((2 * deltaX * targetDistance) / height, camera.worldTransform);
      this._panUp((2 * deltaY * targetDistance) / height, camera.worldTransform);
    } else {
      const width = this._viewportWidth();
      const size = 2 * camera.orthographicSize;

      this._panLeft((deltaX * size) / width, camera.worldTransform);
      this._panUp((deltaY * size * (height / width)) / height, camera.worldTransform);
    }
  }

  private _clampDistance(dist: number): number {
    return clamp(dist, this.minDistance, this.maxDistance);
  }

  /**
   * Aim the cursor-zoom direction through a global 2D point
   * @param global - Point in global 2D coordinates to zoom toward
   */
  private _setZoomDirection(global: PointData): void {
    if (!this.zoomToCursor) return;

    this._performCursorZoom = true;
    this.view.screenToRay(global, _ray);
    this._zoomDirection.copyFrom(_ray.direction);
  }

  /**
   * Convert an event's global position into View-local pixels, kept in `_local`
   * @param event - Pointer event to read the position from
   */
  private _toLocal(event: FederatedPointerEvent): Vector2 {
    this.view.toLocal(event.global, undefined, this._local, true);

    return this._local;
  }

  private _trackPointer(pointerId: number, position: Vector2): void {
    let tracked = this._pointerPositions.get(pointerId);

    if (tracked === undefined) {
      tracked = new Vector2();
      this._pointerPositions.set(pointerId, tracked);
    }

    tracked.copyFrom(position);
  }

  private _otherPointer(pointerId: number): Vector2 {
    const otherId = pointerId === this._pointers[0] ? this._pointers[1] : this._pointers[0];

    return this._pointerPositions.get(otherId)!;
  }

  /**
   * Midpoint of the active touch pair (or `position` itself for one finger), written to `out`
   * @param pointerId - The pointer that moved
   * @param position - Its View-local position
   * @param out - Receives the midpoint
   */
  private _touchCenter(pointerId: number, position: Vector2, out: Vector2): Vector2 {
    if (this._pointers.length === 1) return out.copyFrom(position);

    const other = this._otherPointer(pointerId);

    return out.set(0.5 * (position.x + other.x), 0.5 * (position.y + other.y));
  }

  private _touchSpread(pointerId: number, position: Vector2): number {
    const other = this._otherPointer(pointerId);
    const dx = position.x - other.x;
    const dy = position.y - other.y;

    return Math.sqrt(dx * dx + dy * dy);
  }

  private readonly _onPointerDown = (event: FederatedPointerEvent): void => {
    if (!this.enabled || this._pointers.includes(event.pointerId)) return;

    this._pointers.push(event.pointerId);

    const local = this._toLocal(event);

    if (event.pointerType === 'touch') {
      this._startTouch(event.pointerId, local);
    } else {
      this._startMouse(event, local);
    }
  };

  private readonly _onPointerMove = (event: FederatedPointerEvent): void => {
    if (!this.enabled || !this._pointers.includes(event.pointerId)) return;

    const local = this._toLocal(event);

    if (event.pointerType === 'touch') {
      this._moveTouch(event.pointerId, local);
    } else {
      this._moveMouse(local);
    }
  };

  /**
   * Lifting one finger of a pair restarts the one-finger gesture from the finger still down
   * @param event - The pointer-up, up-outside or cancel event
   */
  private readonly _onPointerUp = (event: FederatedPointerEvent): void => {
    const index = this._pointers.indexOf(event.pointerId);

    if (index === -1) return;

    this._pointers.splice(index, 1);
    this._pointerPositions.delete(event.pointerId);

    if (this._pointers.length === 0) {
      this._gesture = 'none';
      this.emit('end');
    } else if (this._pointers.length === 1) {
      const survivor = this._pointers[0];

      this._startTouch(survivor, this._pointerPositions.get(survivor)!);
    }
  };

  /**
   * Line and page deltas (`deltaMode` 1 and 2) are scaled to pixels, and a ctrl-wheel's delta is
   * boosted tenfold: a trackpad pinch arrives as a ctrl-wheel with tiny deltas
   * @param event - The wheel event
   */
  private readonly _onWheel = (event: FederatedWheelEvent): void => {
    if (!this.enabled || !this.enableZoom || this._gesture !== 'none') return;

    let deltaY = event.deltaY;

    if (event.deltaMode === 1) deltaY *= 16;
    else if (event.deltaMode === 2) deltaY *= 100;

    if (event.ctrlKey) deltaY *= 10;

    this.emit('start');

    this._setZoomDirection(event.global);

    if (deltaY < 0) {
      this._scale *= this._zoomScale(deltaY);
    } else if (deltaY > 0) {
      this._scale /= this._zoomScale(deltaY);
    }

    this.update();
    this.emit('end');
  };

  private readonly _onContextMenu = (event: FederatedPointerEvent): void => {
    if (this.enabled && this.preventContextMenu) event.preventDefault();
  };

  /**
   * Start the gesture assigned to the pressed button; ctrl, meta or shift swaps rotate and pan, as
   * desktop 3D tools do
   * @param event - The pointer-down event
   * @param local - Its View-local position
   */
  private _startMouse(event: FederatedPointerEvent, local: Vector2): void {
    let action: OrbitMouseAction;

    switch (event.button) {
      case 0:
        action = this.mouseButtons.left;
        break;
      case 1:
        action = this.mouseButtons.middle;
        break;
      case 2:
        action = this.mouseButtons.right;
        break;
      default:
        action = 'none';
    }

    const modified = event.ctrlKey || event.metaKey || event.shiftKey;

    if (modified && action === 'rotate') action = 'pan';
    else if (modified && action === 'pan') action = 'rotate';

    switch (action) {
      case 'rotate':
        if (!this.enableRotate) return;
        this._rotateStart.copyFrom(local);
        this._gesture = 'rotate';
        break;
      case 'zoom':
        if (!this.enableZoom) return;
        this._setZoomDirection(event.global);
        this._zoomStartY = local.y;
        this._gesture = 'zoom';
        break;
      case 'pan':
        if (!this.enablePan) return;
        this._panStart.copyFrom(local);
        this._gesture = 'pan';
        break;
      default:
        this._gesture = 'none';

        return;
    }

    this.emit('start');
  }

  private _moveMouse(local: Vector2): void {
    switch (this._gesture) {
      case 'rotate':
        if (!this.enableRotate) return;
        this._rotateEnd.copyFrom(local);
        this._rotateDelta.copyFrom(this._rotateEnd).subtract(this._rotateStart).multiplyScalar(this.rotateSpeed);
        this._rotateBy(this._rotateDelta.x, this._rotateDelta.y);
        this._rotateStart.copyFrom(this._rotateEnd);
        break;
      case 'zoom': {
        if (!this.enableZoom) return;

        const deltaY = local.y - this._zoomStartY;

        if (deltaY > 0) this._scale /= this._zoomScale(deltaY);
        else if (deltaY < 0) this._scale *= this._zoomScale(deltaY);

        this._zoomStartY = local.y;
        break;
      }
      case 'pan':
        if (!this.enablePan) return;
        this._panEnd.copyFrom(local);
        this._panDelta.copyFrom(this._panEnd).subtract(this._panStart).multiplyScalar(this.panSpeed);
        this._pan(this._panDelta.x, this._panDelta.y);
        this._panStart.copyFrom(this._panEnd);
        break;
      default:
        return;
    }

    this.update();
  }

  private _startTouch(pointerId: number, local: Vector2): void {
    this._trackPointer(pointerId, local);

    const count = this._pointers.length;
    const action = count === 1 ? this.touches.one : count === 2 ? this.touches.two : 'none';

    switch (action) {
      case 'rotate':
        if (!this.enableRotate) return;
        this._touchCenter(pointerId, local, this._rotateStart);
        this._gesture = 'touch-rotate';
        break;
      case 'pan':
        if (!this.enablePan) return;
        this._touchCenter(pointerId, local, this._panStart);
        this._gesture = 'touch-pan';
        break;
      case 'zoom-pan':
        if (!this.enableZoom && !this.enablePan) return;
        if (this.enableZoom) this._pinchStart = this._touchSpread(pointerId, local);
        if (this.enablePan) this._touchCenter(pointerId, local, this._panStart);
        this._gesture = 'touch-zoom-pan';
        break;
      case 'zoom-rotate':
        if (!this.enableZoom && !this.enableRotate) return;
        if (this.enableZoom) this._pinchStart = this._touchSpread(pointerId, local);
        if (this.enableRotate) this._touchCenter(pointerId, local, this._rotateStart);
        this._gesture = 'touch-zoom-rotate';
        break;
      default:
        this._gesture = 'none';

        return;
    }

    this.emit('start');
  }

  private _moveTouch(pointerId: number, local: Vector2): void {
    this._trackPointer(pointerId, local);

    switch (this._gesture) {
      case 'touch-rotate':
        if (!this.enableRotate) return;
        this._touchRotate(pointerId, local);
        break;
      case 'touch-pan':
        if (!this.enablePan) return;
        this._touchPan(pointerId, local);
        break;
      case 'touch-zoom-pan':
        if (!this.enableZoom && !this.enablePan) return;
        if (this.enableZoom) this._touchPinch(pointerId, local);
        if (this.enablePan) this._touchPan(pointerId, local);
        break;
      case 'touch-zoom-rotate':
        if (!this.enableZoom && !this.enableRotate) return;
        if (this.enableZoom) this._touchPinch(pointerId, local);
        if (this.enableRotate) this._touchRotate(pointerId, local);
        break;
      default:
        this._gesture = 'none';

        return;
    }

    this.update();
  }

  private _touchRotate(pointerId: number, local: Vector2): void {
    this._touchCenter(pointerId, local, this._rotateEnd);
    this._rotateDelta.copyFrom(this._rotateEnd).subtract(this._rotateStart).multiplyScalar(this.rotateSpeed);
    this._rotateBy(this._rotateDelta.x, this._rotateDelta.y);
    this._rotateStart.copyFrom(this._rotateEnd);
  }

  private _touchPan(pointerId: number, local: Vector2): void {
    this._touchCenter(pointerId, local, this._panEnd);
    this._panDelta.copyFrom(this._panEnd).subtract(this._panStart).multiplyScalar(this.panSpeed);
    this._pan(this._panDelta.x, this._panDelta.y);
    this._panStart.copyFrom(this._panEnd);
  }

  /**
   * Zoom by the change in finger spread; with `zoomToCursor` on, toward the fingers' midpoint
   * @param pointerId - The finger that moved
   * @param local - Its View-local position
   */
  private _touchPinch(pointerId: number, local: Vector2): void {
    const spread = this._touchSpread(pointerId, local);

    this._scale /= Math.pow(spread / this._pinchStart, this.zoomSpeed);
    this._pinchStart = spread;

    const center = this._touchCenter(pointerId, local, this._pinchCenter);

    this._setZoomDirection(this.view.toGlobal(center, center, true));
  }
}
