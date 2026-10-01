import type { FederatedPointerEvent } from 'pixi.js';
import { definedProps, EventEmitter, Ticker, UPDATE_PRIORITY } from 'pixi.js';

import { Quaternion } from '../../math/rotation/Quaternion';
import { clamp } from '../../math/utils/clamp';
import type { PointData3D } from '../../math/vector/PointData3D';
import { Vector3 } from '../../math/vector/Vector3';
import type { Camera3D } from '../../scene/cameras/Camera3D';
import type { View3D } from '../../scene/View3D';

/**
 * Constructor options for {@link FPSCamera}
 *
 * Every field but `view` has a default. Every option but `position` is also a property on the
 * instance; move `camera.position` for that.
 * @example
 * ```ts
 * const walker: Omit<FPSCameraOptions, 'view'> = { position: { x: 0, y: 1.7, z: 5 }, moveSpeed: 3 };
 * const fpsCamera = new FPSCamera({ view: view3d, ...walker });
 * ```
 * @see {@link FPSCamera} For the constructed controller.
 * @category extras:camera
 * @standard
 */
export interface FPSCameraOptions {
  /**
   * The {@link View3D} to drive; the controller moves `view.camera` and listens for pointer events on the View
   * @example
   * ```ts
   * const fpsCamera = new FPSCamera({ view: view3d });
   * ```
   */
  view: View3D;
  /**
   * Initial world position; the camera's current position when omitted
   * @example
   * ```ts
   * const fpsCamera = new FPSCamera({ view: view3d, position: { x: 0, y: 1.7, z: 5 } });
   * ```
   */
  position?: PointData3D;
  /**
   * Initial {@link FPSCamera#yaw | yaw} in radians
   * @default 0
   * @example
   * ```ts
   * const fpsCamera = new FPSCamera({ view: view3d, yaw: Math.PI });
   * ```
   */
  yaw?: number;
  /**
   * Initial {@link FPSCamera#pitch | pitch} in radians, clamped to `±maxPitch`
   * @default 0
   * @example
   * ```ts
   * const fpsCamera = new FPSCamera({ view: view3d, pitch: -0.2 });
   * ```
   */
  pitch?: number;
  /**
   * Whether look input and movement apply
   * @default true
   * @example
   * ```ts
   * const fpsCamera = new FPSCamera({ view: view3d, enabled: false });
   *
   * playButton.on('pointertap', () => (fpsCamera.enabled = true));
   * ```
   */
  enabled?: boolean;
  /**
   * Run {@link FPSCamera#update | update()} from `Ticker.shared` every frame
   * @default true
   * @example
   * ```ts
   * const fpsCamera = new FPSCamera({ view: view3d, autoUpdate: false });
   *
   * app.ticker.add((ticker) => fpsCamera.update(ticker));
   * ```
   */
  autoUpdate?: boolean;
  /**
   * Request pointer lock on the canvas when the View is pressed, so the mouse looks around
   * without a button held
   *
   * Dragging still looks around while unlocked, which is how touch input works.
   * @default false
   * @example
   * ```ts
   * const fpsCamera = new FPSCamera({ view: view3d, pointerLock: true });
   * ```
   */
  pointerLock?: boolean;
  /**
   * Keep the browser's context menu from opening over the View, so a right-button drag
   * doesn't open it
   *
   * The View's `hitArea` bounds it like any other pointer event, and the menu still opens while
   * `enabled` is `false`. On Windows the menu opens on release, so a right-button drag that ends
   * outside the View still opens it.
   * @default true
   * @example
   * ```ts
   * const fpsCamera = new FPSCamera({ view: view3d, preventContextMenu: false });
   * ```
   */
  preventContextMenu?: boolean;
  /**
   * Read WASD / arrow keys, Space and Shift from `window` for movement
   *
   * Set `false` to drive {@link FPSCamera#move | move} yourself.
   * @default true
   * @example
   * ```ts
   * const fpsCamera = new FPSCamera({ view: view3d, keyboard: false });
   * ```
   */
  keyboard?: boolean;
  /**
   * Movement speed in world units per second
   * @default 5
   * @example
   * ```ts
   * const fpsCamera = new FPSCamera({ view: view3d, moveSpeed: 10 });
   * ```
   */
  moveSpeed?: number;
  /**
   * Look sensitivity in radians per pixel
   * @default 0.002
   * @example
   * ```ts
   * const fpsCamera = new FPSCamera({ view: view3d, lookSpeed: 0.004 });
   * ```
   */
  lookSpeed?: number;
  /**
   * Pitch clamp in radians, keeping the view short of straight up / down
   * @default Math.PI * 0.49
   * @example
   * ```ts
   * const fpsCamera = new FPSCamera({ view: view3d, maxPitch: Math.PI / 3 });
   * ```
   */
  maxPitch?: number;
}

const _v = new Vector3();
const _qYaw = new Quaternion();
const _qPitch = new Quaternion();
const _yawAxis = new Vector3(0, 1, 0);
const _pitchAxis = new Vector3(1, 0, 0);

/**
 * First-person walker for a {@link View3D}'s camera
 *
 * Drag (or move the mouse under pointer lock) to look around; WASD / arrow keys walk
 * along the view direction and strafe, Space / Shift move along world Y. Yaw is
 * unbounded and pitch is clamped to {@link FPSCamera#maxPitch | maxPitch}.
 * The {@link FPSCamera#move | move} vector takes input from anything else,
 * such as an on-screen joystick.
 *
 * Look input arrives through the View's federated pointer events. Movement is applied by
 * {@link FPSCamera#update | update()}, which runs from `Ticker.shared` unless
 * {@link FPSCamera#autoUpdate | autoUpdate} is off.
 * @example
 * ```ts
 * import { FPSCamera } from '@pixi/3d/extras';
 *
 * const fpsCamera = new FPSCamera({
 *   view: view3d,
 *   position: { x: 0, y: 1.7, z: 5 },
 *   pointerLock: true,
 *   moveSpeed: 6,
 * });
 *
 * fpsCamera.on('lock', () => (hud.hidden = true));
 * fpsCamera.on('unlock', () => (hud.hidden = false));
 *
 * // On teardown:
 * fpsCamera.destroy();
 * ```
 * @remarks
 * The controller blocks the browser's context menu over the View so a right-button drag can
 * look around. Set {@link FPSCamera#preventContextMenu | preventContextMenu} to `false` to
 * keep the menu.
 * @see {@link FPSCameraOptions} For all constructor options.
 * @see {@link OrbitCamera} For orbit / zoom / pan interaction.
 * @see {@link Camera3D} For the underlying camera.
 * @category extras:camera
 * @standard
 */
export class FPSCamera extends EventEmitter<{
  /**
   * The camera moved or turned
   * @example
   * ```ts
   * fpsCamera.on('change', () => (compass.rotation = -fpsCamera.yaw));
   * ```
   */
  change: [];
  /**
   * Pointer lock was acquired on the canvas
   * @example
   * ```ts
   * fpsCamera.on('lock', () => (pauseMenu.visible = false));
   * ```
   */
  lock: [];
  /**
   * Pointer lock was released, such as by the player pressing Escape
   * @example
   * ```ts
   * fpsCamera.on('unlock', () => (pauseMenu.visible = true));
   * ```
   */
  unlock: [];
}> {
  /**
   * Default {@link FPSCameraOptions} merged under every constructor call; mutate to change defaults process-wide
   * @example
   * ```ts
   * FPSCamera.defaultOptions.pointerLock = true;
   * ```
   */
  public static defaultOptions: Partial<Omit<FPSCameraOptions, 'view'>> = {
    yaw: 0,
    pitch: 0,
    enabled: true,
    autoUpdate: true,
    pointerLock: false,
    preventContextMenu: true,
    keyboard: true,
    moveSpeed: 5,
    lookSpeed: 0.002,
    maxPitch: Math.PI * 0.49,
  };

  /**
   * The {@link View3D} this controller listens on and whose camera it drives
   * @example
   * ```ts
   * fpsCamera.view.cursor = 'crosshair';
   * ```
   */
  public readonly view: View3D;

  /**
   * Whether look input and movement apply
   *
   * Disabling it doesn't release pointer lock, so a menu that needs the cursor has to exit the
   * lock itself.
   * @example
   * ```ts
   * inventory.on('open', () => {
   *   fpsCamera.enabled = false;
   *   document.exitPointerLock();
   * });
   * ```
   */
  public enabled: boolean;

  /**
   * Request pointer lock on the canvas when the View is pressed
   * @example
   * ```ts
   * fpsCamera.pointerLock = settings.captureMouse;
   * ```
   */
  public pointerLock: boolean;

  /**
   * Whether the browser's context menu is kept from opening over the View;
   * {@link FPSCameraOptions#preventContextMenu} covers where it still opens
   * @example
   * ```ts
   * fpsCamera.preventContextMenu = false;
   * ```
   */
  public preventContextMenu: boolean;

  /**
   * Movement speed in world units per second
   *
   * Diagonal input isn't normalised, so moving forward and sideways at once is about 1.4 times
   * faster.
   * @example
   * ```ts
   * window.addEventListener('keydown', (event) => {
   *   if (event.code === 'ControlLeft') fpsCamera.moveSpeed = 10;
   * });
   * window.addEventListener('keyup', (event) => {
   *   if (event.code === 'ControlLeft') fpsCamera.moveSpeed = 5;
   * });
   * ```
   */
  public moveSpeed = 0;

  /**
   * Look sensitivity in radians per pixel
   * @example
   * ```ts
   * fpsCamera.lookSpeed = 0.002 * settings.mouseSensitivity;
   * ```
   */
  public lookSpeed = 0;

  /**
   * Pitch clamp in radians
   * @example
   * ```ts
   * fpsCamera.maxPitch = Math.PI / 3;
   * ```
   */
  public maxPitch = 0;

  /**
   * External movement input, each axis in `[-1, 1]`
   *
   * `x` strafes right, `y` rises along world Y, `z` walks forward. Added to the keyboard
   * input on every update; set it from a joystick or gamepad and leave it at zero otherwise.
   * @example
   * ```ts
   * app.ticker.add(() => {
   *   const pad = navigator.getGamepads()[0];
   *
   *   if (pad) fpsCamera.move.set(pad.axes[0], 0, -pad.axes[1]);
   * });
   * ```
   */
  public readonly move = new Vector3();

  private _yaw = 0;
  private _pitch = 0;
  private readonly _orientation = new Quaternion();

  private _autoUpdate = false;
  private _keyboard = false;
  private readonly _keys = new Set<string>();

  private _lockTarget: Element | null = null;
  private _locked = false;
  private _dragPointer: number | null = null;
  private _lastX = 0;
  private _lastY = 0;

  /**
   * Creates a new `FPSCamera` bound to `options.view`
   *
   * Listeners are wired immediately; call {@link FPSCamera#destroy | destroy()}
   * to remove them.
   * @param options - construction options; see {@link FPSCameraOptions}
   */
  constructor(options: FPSCameraOptions) {
    super();

    const opts = { ...FPSCamera.defaultOptions, ...definedProps(options) };

    this.view = options.view;
    this.enabled = opts.enabled!;
    this.pointerLock = opts.pointerLock!;
    this.preventContextMenu = opts.preventContextMenu!;
    this.moveSpeed = opts.moveSpeed!;
    this.lookSpeed = opts.lookSpeed!;
    this.maxPitch = opts.maxPitch!;
    this._yaw = opts.yaw!;
    this._pitch = clamp(opts.pitch!, -this.maxPitch, this.maxPitch);

    if (opts.position) this.camera.position.copyFrom(opts.position);

    const view = this.view;

    view.on('pointerdown', this._onPointerDown);
    view.on('globalpointermove', this._onPointerMove);
    view.on('pointerup', this._onPointerUp);
    view.on('pointerupoutside', this._onPointerUp);
    view.on('pointercancel', this._onPointerUp);
    view.on('contextmenu', this._onContextMenu);
    // oxlint-disable-next-line no-restricted-globals -- pointer lock is document-only; DOMAdapter has no equivalent
    document.addEventListener('pointerlockchange', this._onLockChange);

    this.keyboard = opts.keyboard!;
    this.autoUpdate = opts.autoUpdate!;

    this._applyOrientation();
  }

  /**
   * The {@link Camera3D} being driven, always `view.camera`
   *
   * Its rotation belongs to the controller, and the next look input overwrites a rotation set on
   * the camera directly. Turn it with {@link FPSCamera#yaw | yaw} and {@link FPSCamera#pitch | pitch}.
   * @example
   * ```ts
   * fpsCamera.on('change', () => {
   *   if (fpsCamera.camera.position.y < -10) respawn();
   * });
   * ```
   */
  public get camera(): Camera3D {
    return this.view.camera;
  }

  /**
   * Yaw in radians, around world Y: 0 faces -Z, and positive values turn left
   * @example
   * ```ts
   * window.addEventListener('keydown', (event) => {
   *   if (event.code === 'KeyQ') fpsCamera.yaw += Math.PI / 4;
   * });
   * ```
   */
  public get yaw(): number {
    return this._yaw;
  }

  /**
   * Sets the yaw and turns the camera
   * @param value - Yaw in radians; unbounded
   */
  public set yaw(value: number) {
    this._yaw = value;
    this._applyOrientation();
  }

  /**
   * Pitch in radians, clamped to `±maxPitch`: 0 is level, and positive values look up
   * @example
   * ```ts
   * fpsCamera.pitch = 0;
   * ```
   */
  public get pitch(): number {
    return this._pitch;
  }

  /**
   * Sets the pitch and tilts the camera
   * @param value - Pitch in radians; clamped to `±maxPitch`
   */
  public set pitch(value: number) {
    this._pitch = clamp(value, -this.maxPitch, this.maxPitch);
    this._applyOrientation();
  }

  /**
   * Whether the canvas currently holds pointer lock for this controller
   * @example
   * ```ts
   * app.ticker.add(() => (clickToPlay.visible = fpsCamera.pointerLock && !fpsCamera.locked));
   * ```
   */
  public get locked(): boolean {
    return this._locked;
  }

  /**
   * Whether WASD / arrow keys, Space and Shift are read from `window`
   *
   * Keys are matched by position (`KeyboardEvent.code`), so the same physical keys work on any
   * keyboard layout.
   * @example
   * ```ts
   * chatInput.addEventListener('focus', () => (fpsCamera.keyboard = false));
   * chatInput.addEventListener('blur', () => (fpsCamera.keyboard = true));
   * ```
   */
  public get keyboard(): boolean {
    return this._keyboard;
  }

  /**
   * Adds or removes the `window` key listeners
   * @param value - Whether to read movement keys from `window`
   */
  public set keyboard(value: boolean) {
    if (value === this._keyboard) return;

    this._keyboard = value;

    if (value) {
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);
      window.addEventListener('blur', this._onBlur);
    } else {
      window.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('keyup', this._onKeyUp);
      window.removeEventListener('blur', this._onBlur);
      this._keys.clear();
    }
  }

  /**
   * Whether {@link FPSCamera#update | update()} runs from `Ticker.shared` every frame
   *
   * {@link OrbitCamera#autoUpdate} explains why updating from `app.ticker` keeps movement in step
   * with the render.
   * @example
   * ```ts
   * fpsCamera.autoUpdate = false;
   * app.ticker.add((ticker) => fpsCamera.update(ticker));
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
   * Remove every listener, release pointer lock, and drop event subscribers
   *
   * The View and camera are owned by the caller and are left intact.
   * @example
   * ```ts
   * fpsCamera.destroy();
   * const orbit = new OrbitCamera({ view: view3d });
   * ```
   */
  public destroy(): void {
    this.autoUpdate = false;
    this.keyboard = false;

    const view = this.view;

    view.off('pointerdown', this._onPointerDown);
    view.off('globalpointermove', this._onPointerMove);
    view.off('pointerup', this._onPointerUp);
    view.off('pointerupoutside', this._onPointerUp);
    view.off('pointercancel', this._onPointerUp);
    view.off('contextmenu', this._onContextMenu);
    // oxlint-disable-next-line no-restricted-globals -- pointer lock is document-only; DOMAdapter has no equivalent
    document.removeEventListener('pointerlockchange', this._onLockChange);

    // oxlint-disable-next-line no-restricted-globals -- pointer lock is document-only; DOMAdapter has no equivalent
    if (this._locked) document.exitPointerLock();

    this._lockTarget = null;
    this._dragPointer = null;

    this.removeAllListeners();
  }

  /**
   * Apply this frame's movement input to the camera
   *
   * Runs every frame while {@link FPSCamera#autoUpdate | autoUpdate} is on. Call
   * it yourself when driving the controller from your own loop.
   *
   * Walking follows the full view direction, pitch included, so walking forward while looking down
   * descends. Strafing stays level, and Space and Shift move along world Y whatever the pitch.
   * @example
   * ```ts
   * fpsCamera.autoUpdate = false;
   * app.ticker.add((ticker) => {
   *   if (fpsCamera.update(ticker)) resolveWallCollisions(fpsCamera.camera.position);
   * });
   * ```
   * @param ticker - The ticker driving this update; supplies the frame time. Omitted, one
   *   60 fps frame is assumed.
   * @returns `true` when the camera moved
   */
  public update(ticker?: Ticker): boolean {
    if (!this.enabled) return false;

    const keys = this._keys;
    let x = this.move.x;
    let y = this.move.y;
    let z = this.move.z;

    if (keys.has('KeyW') || keys.has('ArrowUp')) z += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) z -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('Space')) y += 1;
    if (keys.has('ShiftLeft') || keys.has('ShiftRight')) y -= 1;

    if (x === 0 && y === 0 && z === 0) return false;

    const step = this.moveSpeed * (ticker ? ticker.deltaMS / 1000 : 1 / 60);
    const position = this.camera.position;

    _v.set(x, 0, -z).applyQuaternion(this._orientation);
    position.set(position.x + _v.x * step, position.y + (_v.y + y) * step, position.z + _v.z * step);

    this.emit('change');

    return true;
  }

  private readonly _onTick = (ticker: Ticker): void => {
    this.update(ticker);
  };

  private _look(deltaX: number, deltaY: number): void {
    if (deltaX === 0 && deltaY === 0) return;

    this._yaw -= deltaX * this.lookSpeed;
    this._pitch = clamp(this._pitch - deltaY * this.lookSpeed, -this.maxPitch, this.maxPitch);
    this._applyOrientation();
  }

  private _applyOrientation(): void {
    _qYaw.setFromAxisAngle(_yawAxis, this._yaw);
    _qPitch.setFromAxisAngle(_pitchAxis, this._pitch);
    this._orientation.copyFrom(_qYaw).multiply(_qPitch).normalize();

    this.camera.quaternion.copyFrom(this._orientation);
    this.emit('change');
  }

  private readonly _onPointerDown = (event: FederatedPointerEvent): void => {
    if (!this.enabled) return;

    if (this.pointerLock && !this._locked && event.pointerType === 'mouse') {
      const target = event.nativeEvent.target;

      if (target instanceof Element) {
        this._lockTarget = target;
        void target.requestPointerLock();
      }

      return;
    }

    if (this._dragPointer !== null) return;

    this._dragPointer = event.pointerId;
    this._lastX = event.global.x;
    this._lastY = event.global.y;
  };

  private readonly _onPointerMove = (event: FederatedPointerEvent): void => {
    if (!this.enabled) return;

    if (this._locked) {
      this._look(event.movement.x, event.movement.y);

      return;
    }

    if (event.pointerId !== this._dragPointer) return;

    const x = event.global.x;
    const y = event.global.y;

    this._look(x - this._lastX, y - this._lastY);
    this._lastX = x;
    this._lastY = y;
  };

  private readonly _onPointerUp = (event: FederatedPointerEvent): void => {
    if (event.pointerId === this._dragPointer) this._dragPointer = null;
  };

  private readonly _onContextMenu = (event: FederatedPointerEvent): void => {
    if (this.enabled && this.preventContextMenu) event.preventDefault();
  };

  private readonly _onLockChange = (): void => {
    // oxlint-disable-next-line no-restricted-globals -- pointer lock is document-only; DOMAdapter has no equivalent
    const locked = this._lockTarget !== null && document.pointerLockElement === this._lockTarget;

    if (locked === this._locked) return;

    this._locked = locked;

    if (locked) {
      this._dragPointer = null;
      this.emit('lock');
    } else {
      this._keys.clear();
      this.emit('unlock');
    }
  };

  private readonly _onKeyDown = (event: KeyboardEvent): void => {
    this._keys.add(event.code);
  };

  private readonly _onKeyUp = (event: KeyboardEvent): void => {
    this._keys.delete(event.code);
  };

  private readonly _onBlur = (): void => {
    this._keys.clear();
  };
}
