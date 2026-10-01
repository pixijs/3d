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
 * Writes four-component samples to a quaternion, renormalised to unit length
 *
 * Blending several states averages unit quaternions component by component, which comes out
 * shorter than unit length and would scale the transform. A zero-length sample writes the
 * identity rotation.
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
    const lengthSq = x * x + y * y + z * z + w * w;

    if (lengthSq === 0) {
      this._target.set(0, 0, 0, 1);

      return;
    }
    const inv = 1 / Math.sqrt(lengthSq);

    this._target.set(x * inv, y * inv, z * inv, w * inv);
  }
}
