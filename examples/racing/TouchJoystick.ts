import type { FederatedPointerEvent } from 'pixi.js';
import { Container, Graphics } from 'pixi.js';

const STEER_RANGE = 40;
const KNOB_TRAVEL = 60;

export class TouchJoystick extends Container {
  public dirX = 0;
  public dirY = 0;
  public touchActive = false;

  private _pointerId: number | null = null;
  private _startX = 0;
  private _startY = 0;

  private readonly _hitArea: Graphics;
  private readonly _ring: Graphics;
  private readonly _knob: Graphics;

  constructor(width: number, height: number) {
    super();

    this.eventMode = 'static';

    this._hitArea = new Graphics().rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.001 });
    this._hitArea.eventMode = 'static';
    this.addChild(this._hitArea);

    this._ring = new Graphics()
      .circle(0, 0, 70)
      .fill({ color: 0xffffff, alpha: 0.08 })
      .circle(0, 0, 70)
      .stroke({ width: 2, color: 0xffffff, alpha: 0.25 });
    this._ring.visible = false;
    this.addChild(this._ring);

    this._knob = new Graphics().circle(0, 0, 30).fill({ color: 0xffffff, alpha: 0.4 });
    this._knob.visible = false;
    this.addChild(this._knob);

    this._hitArea.on('pointerdown', this._onDown);
    this._hitArea.on('pointermove', this._onMove);
    this._hitArea.on('pointerup', this._onUp);
    this._hitArea.on('pointerupoutside', this._onUp);
    this._hitArea.on('pointercancel', this._onUp);
  }

  public resize(width: number, height: number): void {
    this._hitArea.clear().rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.001 });
  }

  private readonly _onDown = (e: FederatedPointerEvent): void => {
    if (this._pointerId !== null) return;
    if (e.pointerType !== 'touch') return;

    this._pointerId = e.pointerId;
    this._startX = e.global.x;
    this._startY = e.global.y;
    this.touchActive = true;
    this.dirX = 0;
    this.dirY = 0;

    this._ring.position.set(this._startX, this._startY);
    this._knob.position.set(this._startX, this._startY);
    this._ring.visible = true;
    this._knob.visible = true;
  };

  private readonly _onMove = (e: FederatedPointerEvent): void => {
    if (e.pointerId !== this._pointerId) return;

    let dx = (e.global.x - this._startX) / STEER_RANGE;
    let dy = (e.global.y - this._startY) / STEER_RANGE;
    const mag = Math.sqrt(dx * dx + dy * dy);

    if (mag > 1) {
      dx /= mag;
      dy /= mag;
    }

    this.dirX = dx;
    this.dirY = dy;

    this._knob.position.set(this._startX + dx * KNOB_TRAVEL, this._startY + dy * KNOB_TRAVEL);
  };

  private readonly _onUp = (e: FederatedPointerEvent): void => {
    if (e.pointerId !== this._pointerId) return;

    this._pointerId = null;
    this.touchActive = false;
    this.dirX = 0;
    this.dirY = 0;
    this._ring.visible = false;
    this._knob.visible = false;
  };
}
