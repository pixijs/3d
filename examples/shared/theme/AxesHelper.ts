/**
 * A node's own x, y and z axes, as three arrows from its origin
 *
 * Add it as the node's child and it turns and scales with the node, so it shows the node's own space: a scaled node's
 * axes stretch with it. Its origin dot marks the point the node turns about. The arrows keep their axis colours and
 * the dot its ink; `muted`, `opacity`, `xray` and `pass` reach all four.
 */

import { Vector3 } from '@pixi/3d';

import { ArrowHelper } from './ArrowHelper';
import { Helper } from './Helper';
import type { HelperOptions } from './Helper';
import { helperGeometry } from './helpers';

/** Options for {@link AxesHelper} */
export interface AxesHelperOptions extends HelperOptions {
  /** Each arrow's length, in the parent's units before the parent's scale. @default 1 */
  length?: number;
  /** @default 0.04 */
  thickness?: number;
}

const ORIGIN = { x: 0, y: 0, z: 0 };

/** A node's own axes as x, y and z arrows and an origin dot; seven draws on WebGPU, three on WebGL */
export class AxesHelper extends Helper {
  public readonly xAxis: ArrowHelper;
  public readonly yAxis: ArrowHelper;
  public readonly zAxis: ArrowHelper;
  /** Where each arrow ends, in this helper's space, for pinning labels to the tips */
  public readonly tips: { readonly x: Vector3; readonly y: Vector3; readonly z: Vector3 };

  constructor({ length = 1, thickness = 0.04, ...options }: AxesHelperOptions = {}) {
    super(options, 'ink');

    const { opacity, xray, muted, pass } = options;
    const look = { thickness, opacity, xray, muted, pass, parent: this };

    this._addPart(helperGeometry('dot'), 1, 'ink').scale.set(thickness * 1.4);
    this.tips = { x: new Vector3(length, 0, 0), y: new Vector3(0, length, 0), z: new Vector3(0, 0, length) };
    this.xAxis = new ArrowHelper({ ...look, color: 'x' }).set(ORIGIN, this.tips.x);
    this.yAxis = new ArrowHelper({ ...look, color: 'y' }).set(ORIGIN, this.tips.y);
    this.zAxis = new ArrowHelper({ ...look, color: 'z' }).set(ORIGIN, this.tips.z);
  }

  public override destroy(options?: Parameters<Helper['destroy']>[0]): void {
    this.xAxis.destroy();
    this.yAxis.destroy();
    this.zAxis.destroy();
    super.destroy(options);
  }

  protected override _paint(): void {
    super._paint();
    this._follow(this.xAxis);
    this._follow(this.yAxis);
    this._follow(this.zAxis);
  }

  private _follow(arrow: ArrowHelper): void {
    arrow.muted = this.muted;
    arrow.opacity = this.opacity;
    arrow.xray = this.xray;
    arrow.pass = this.pass;
  }
}
