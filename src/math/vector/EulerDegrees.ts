import { DEG_TO_RAD, RAD_TO_DEG } from 'pixi.js';

import type { ObservableVector3 } from './ObservableVector3';
import type { PointData3D } from './PointData3D';
import type { PointLike3D } from './PointLike3D';

/**
 * Reads and writes a node's radian `rotation` in degrees and stores nothing, so `angle` and `rotation` always agree
 * @internal
 */
export class EulerDegrees implements PointLike3D {
  constructor(private readonly _radians: ObservableVector3) {}

  get x(): number {
    return this._radians._x * RAD_TO_DEG;
  }

  set x(value: number) {
    this._radians.x = value * DEG_TO_RAD;
  }

  get y(): number {
    return this._radians._y * RAD_TO_DEG;
  }

  set y(value: number) {
    this._radians.y = value * DEG_TO_RAD;
  }

  get z(): number {
    return this._radians._z * RAD_TO_DEG;
  }

  set z(value: number) {
    this._radians.z = value * DEG_TO_RAD;
  }

  public set(x = 0, y = x, z = x): this {
    this._radians.set(x * DEG_TO_RAD, y * DEG_TO_RAD, z * DEG_TO_RAD);

    return this;
  }

  public copyFrom(p: PointData3D): this {
    return this.set(p.x, p.y, p.z);
  }

  public copyTo<T extends PointLike3D>(p: T): T {
    return p.set(this.x, this.y, this.z);
  }

  public equals(p: PointData3D): boolean {
    return p.x === this.x && p.y === this.y && p.z === this.z;
  }
}
