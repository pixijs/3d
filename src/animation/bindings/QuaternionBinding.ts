import type { QuaternionData } from '../../math/rotation/Quaternion';
import { Binding } from './Binding';

/**
 * Quaternion-like target with a single batched setter
 *
 * Covers `Quaternion` and `ObservableQuaternion` so the observer fires once per
 * sample, not four times.
 * @internal
 */
interface QuaternionSettable extends QuaternionData {
  set: (x: number, y: number, z: number, w: number) => this;
}

/**
 * Applies four-component samples to objects that expose mutable quaternion data
 * @internal
 */
export class QuaternionBinding extends Binding {
  constructor(private readonly _target: QuaternionSettable) {
    super();
  }

  public apply(value: Float32Array): void {
    const x = value[0];
    const y = value[1];
    const z = value[2];
    const w = value[3];
    // Blended samples are a weighted average of unit quaternions (nlerp) —
    // renormalize so consumers always see a unit rotation.
    const lengthSq = x * x + y * y + z * z + w * w;

    if (lengthSq === 0) {
      this._target.set(0, 0, 0, 1);

      return;
    }
    const inv = 1 / Math.sqrt(lengthSq);

    this._target.set(x * inv, y * inv, z * inv, w * inv);
  }
}
