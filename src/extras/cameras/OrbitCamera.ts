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
 * What a mouse button does when dragged — assign one to each slot of
 * {@link OrbitCamera#mouseButtons}
 * @category extras:camera
 * @standard
 */
export type OrbitMouseAction = 'rotate' | 'zoom' | 'pan' | 'none';

/**
 * What a touch gesture does — assign one to each slot of {@link OrbitCamera#touches}
 *
 * The two-finger combos pinch to zoom while dragging the midpoint pans or rotates.
 * @category extras:camera
 * @standard
 */
export type OrbitTouchAction = 'rotate' | 'pan' | 'zoom-pan' | 'zoom-rotate' | 'none';

/**
 * Mouse-button action assignments for {@link OrbitCamera}
 * @category extras:camera
 * @standard
 */
export interface OrbitMouseButtons {
  /**
   * Action for the left mouse button
   * @default 'rotate'
   */
  left: OrbitMouseAction;
  /**
   * Action for the middle mouse button
   * @default 'zoom'
   */
  middle: OrbitMouseAction;
  /**
   * Action for the right mouse button
   * @default 'pan'
   */
  right: OrbitMouseAction;
}

/**
 * Touch-gesture action assignments for {@link OrbitCamera}
 * @category extras:camera
 * @standard
 */
export interface OrbitTouches {
  /**
   * Action for a single-finger drag
   * @default 'rotate'
   */
  one: OrbitTouchAction;
  /**
   * Action for a two-finger gesture
   * @default 'zoom-pan'
   */
  two: OrbitTouchAction;
}

/**
 * Constructor options for {@link OrbitCamera}
 *
 * Every field but `view` has a default; pass only what you need. Every option is also a
 * property on the instance and can be changed at runtime.
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
   */
  view: View3D;
  /** World-space orbit target — `(0, 0, 0)` when omitted */
  target?: PointData3D;
  /**
   * Master enable/disable
   * @default true
   */
  enabled?: boolean;
  /**
   * Run {@link OrbitCamera#update | update()} from `Ticker.shared` every frame
   *
   * Set `false` to drive updates yourself.
   * @default true
   */
  autoUpdate?: boolean;
  /**
   * Minimum distance from `target`
   * @default 0
   */
  minDistance?: number;
  /**
   * Maximum distance from `target`
   * @default Infinity
   */
  maxDistance?: number;
  /**
   * Minimum camera zoom (orthographic only)
   * @default 0
   */
  minZoom?: number;
  /**
   * Maximum camera zoom (orthographic only)
   * @default Infinity
   */
  maxZoom?: number;
  /**
   * Minimum polar angle in radians (0 = looking down `up`)
   * @default 0
   */
  minPolarAngle?: number;
  /**
   * Maximum polar angle in radians
   * @default Math.PI
   */
  maxPolarAngle?: number;
  /**
   * Minimum azimuth angle in radians
   * @default -Infinity
   */
  minAzimuthAngle?: number;
  /**
   * Maximum azimuth angle in radians
   * @default Infinity
   */
  maxAzimuthAngle?: number;
  /**
   * Enable inertial damping
   * @default false
   */
  enableDamping?: boolean;
  /**
   * Damping coefficient when `enableDamping` is on
   * @default 0.05
   */
  dampingFactor?: number;
  /**
   * Master zoom enable
   * @default true
   */
  enableZoom?: boolean;
  /**
   * Zoom sensitivity
   * @default 1
   */
  zoomSpeed?: number;
  /**
   * Master rotate enable
   * @default true
   */
  enableRotate?: boolean;
  /**
   * Rotate sensitivity
   * @default 1
   */
  rotateSpeed?: number;
  /**
   * Master pan enable
   * @default true
   */
  enablePan?: boolean;
  /**
   * Pan sensitivity
   * @default 1
   */
  panSpeed?: number;
  /**
   * When `true`, panning translates in screen space; when `false`, panning translates
   * orthogonal to {@link OrbitCamera#up}
   * @default true
   */
  screenSpacePanning?: boolean;
  /**
   * When `true`, the wheel zooms toward the pointer instead of the target
   * @default false
   */
  zoomToCursor?: boolean;
  /**
   * Auto-orbit around `target` while idle
   * @default false
   */
  autoRotate?: boolean;
  /**
   * Auto-rotate speed in revolutions per minute
   * @default 2
   */
  autoRotateSpeed?: number;
  /** Mouse-button action assignments, merged over the defaults */
  mouseButtons?: Partial<OrbitMouseButtons>;
  /** Touch-gesture action assignments, merged over the defaults */
  touches?: Partial<OrbitTouches>;
  /** World-space up axis — `(0, 1, 0)` when omitted */
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
const _TILT_LIMIT = Math.cos(70 * (Math.PI / 180));
const _worldUp = new Vector3(0, 1, 0);

const _v = new Vector3();
const _plane = new Plane();
const _ray = new Ray();

// Cursor-zoom scratch — `update()` runs every frame the user is zooming.
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
 * const controls = new OrbitCamera({
 *   view: view3d,
 *   target: { x: 0, y: 1, z: 0 },
 *   enableDamping: true,
 *   minDistance: 2,
 *   maxDistance: 20,
 * });
 *
 * controls.on('change', () => console.log('camera moved'));
 *
 * // On teardown:
 * controls.destroy();
 * ```
 * @remarks
 * Pixi registers its wheel listener as passive, so wheel zoom can't stop the page from
 * scrolling — keep the canvas from overflowing its container instead.
 * @see {@link OrbitCameraOptions} For all constructor options.
 * @see {@link FPSCamera} For a first-person walker controller.
 * @see {@link Camera3D} For the underlying camera.
 * @category extras:camera
 * @standard
 */
export class OrbitCamera extends EventEmitter<{
  /** A pointer or wheel gesture started */
  start: [];
  /** A pointer or wheel gesture ended */
  end: [];
  /** The camera or target moved */
  change: [];
}> {
  /**
   * Default {@link OrbitCameraOptions} merged under every constructor call
   *
   * `new OrbitCamera(opts)` resolves as `{ ...OrbitCamera.defaultOptions, ...opts }`.
   * Mutate to change defaults process-wide.
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
  };

  /** The {@link View3D} this controller listens on and whose camera it drives */
  public readonly view: View3D;

  /** Master enable/disable */
  public enabled: boolean;

  /** World-space orbit target; mutate freely, and the change shows on the next update */
  public readonly target = new Vector3();

  /** Minimum distance from `target` */
  public minDistance: number;
  /** Maximum distance from `target` */
  public maxDistance: number;

  /** Minimum camera zoom (orthographic only) */
  public minZoom: number;
  /** Maximum camera zoom (orthographic only) */
  public maxZoom: number;

  /** Minimum polar angle in radians */
  public minPolarAngle: number;
  /** Maximum polar angle in radians */
  public maxPolarAngle: number;

  /** Minimum azimuth angle in radians */
  public minAzimuthAngle: number;
  /** Maximum azimuth angle in radians */
  public maxAzimuthAngle: number;

  /** Enable inertial damping */
  public enableDamping: boolean;
  /** Damping coefficient when `enableDamping` is on */
  public dampingFactor: number;

  /** Master zoom enable */
  public enableZoom: boolean;
  /** Zoom sensitivity */
  public zoomSpeed: number;

  /** Master rotate enable */
  public enableRotate: boolean;
  /** Rotate sensitivity */
  public rotateSpeed: number;

  /** Master pan enable */
  public enablePan: boolean;
  /** Pan sensitivity */
  public panSpeed: number;
  /** When `true`, panning translates in screen space */
  public screenSpacePanning: boolean;

  /** When `true`, the wheel zooms toward the pointer */
  public zoomToCursor: boolean;

  /** Auto-orbit around `target` while idle */
  public autoRotate: boolean;
  /** Auto-rotate speed in revolutions per minute */
  public autoRotateSpeed: number;

  /** Mouse-button action assignments */
  public readonly mouseButtons: OrbitMouseButtons;
  /** Touch-gesture action assignments */
  public readonly touches: OrbitTouches;

  private readonly _up = new Vector3(0, 1, 0);
  // Re-orients the world so `up` aligns with +Y, so the spherical math always runs in the
  // canonical up-is-+Y frame.
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

  // Active pointer ids in press order, and each one's last View-local position.
  private readonly _pointers: number[] = [];
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

    this.autoUpdate = opts.autoUpdate!;

    this.update();
  }

  /** The {@link Camera3D} being driven — always `view.camera` */
  public get camera(): Camera3D {
    return this.view.camera;
  }

  /** World-space up axis; assigning re-orients the orbit frame, and the camera settles on the next update */
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
   * Turn off to drive updates from your own loop.
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

  /** Current polar angle in radians (0 = looking straight down `up`) */
  public get polarAngle(): number {
    return this._spherical.phi;
  }

  /** Current azimuth angle in radians (around `up`) */
  public get azimuthAngle(): number {
    return this._spherical.theta;
  }

  /** Current world-space distance from the camera to {@link OrbitCamera#target | target} */
  public get distance(): number {
    return _v.copyFrom(this.camera.position).distanceTo(this.target);
  }

  /**
   * Remove every listener, stop auto-updating, and drop event subscribers
   *
   * The View and camera are owned by the caller and are left intact, so a stray
   * {@link OrbitCamera#update | update()} after destroy is harmless.
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

    this._pointers.length = 0;
    this._pointerPositions.clear();
    this._gesture = 'none';

    this.removeAllListeners();
  }

  /** Snapshot `target`, `camera.position`, and `camera.zoom` for a later {@link OrbitCamera#reset | reset()} */
  public saveState(): void {
    this._savedTarget.copyFrom(this.target);
    this._savedPosition.copyFrom(this.camera.position);
    this._savedZoom = this.camera.zoom;
  }

  /** Restore the last {@link OrbitCamera#saveState | saveState()} snapshot (the construction pose by default) */
  public reset(): void {
    this.target.copyFrom(this._savedTarget);
    this.camera.position.copyFrom(this._savedPosition);
    this.camera.zoom = this._savedZoom;

    this.emit('change');
    this.update();
    this._gesture = 'none';
  }

  /**
   * Rotate around `target` by the given angles and apply the update
   * @param azimuth - rotation around `up` in radians; positive turns the camera left
   * @param polar - rotation toward `up` in radians; positive tilts the camera up
   */
  public rotate(azimuth: number, polar: number): void {
    this._sphericalDelta.theta -= azimuth;
    this._sphericalDelta.phi -= polar;
    this.update();
  }

  /**
   * Pan the target by `(deltaX, deltaY)` View pixels and apply the update
   * @param deltaX - horizontal pan amount in pixels
   * @param deltaY - vertical pan amount in pixels
   */
  public pan(deltaX: number, deltaY: number): void {
    this._pan(deltaX, deltaY);
    this.update();
  }

  /**
   * Zoom by a multiplicative `factor` and apply the update
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
   * @param ticker - the ticker driving this update; supplies frame timing for auto-rotate.
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

  // -- Orbit maths --

  /** Height in View pixels of the camera's viewport — the reference length for drag deltas */
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

  // -- Pointer bookkeeping --

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

  // -- Event handlers --

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

  private readonly _onPointerUp = (event: FederatedPointerEvent): void => {
    const index = this._pointers.indexOf(event.pointerId);

    if (index === -1) return;

    this._pointers.splice(index, 1);
    this._pointerPositions.delete(event.pointerId);

    if (this._pointers.length === 0) {
      this._gesture = 'none';
      this.emit('end');
    } else if (this._pointers.length === 1) {
      // Lifting one finger of a pair restarts the single-finger gesture from the survivor.
      const survivor = this._pointers[0];

      this._startTouch(survivor, this._pointerPositions.get(survivor)!);
    }
  };

  private readonly _onWheel = (event: FederatedWheelEvent): void => {
    if (!this.enabled || !this.enableZoom || this._gesture !== 'none') return;

    let deltaY = event.deltaY;

    // Normalise line / page deltas to pixels.
    if (event.deltaMode === 1) deltaY *= 16;
    else if (event.deltaMode === 2) deltaY *= 100;

    // Trackpad pinch arrives as a ctrl-wheel with tiny deltas.
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

  // -- Mouse gestures --

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

    // A modifier swaps rotate and pan, matching the common desktop convention.
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

  // -- Touch gestures --

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

  private _touchPinch(pointerId: number, local: Vector2): void {
    const spread = this._touchSpread(pointerId, local);

    this._scale /= Math.pow(spread / this._pinchStart, this.zoomSpeed);
    this._pinchStart = spread;

    // Pinch zooms toward the midpoint of the two fingers.
    const center = this._touchCenter(pointerId, local, this._pinchCenter);

    this._setZoomDirection(this.view.toGlobal(center, center, true));
  }
}
