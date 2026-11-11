import type { QuaternionData } from '../../math/rotation/Quaternion';
import { Binding } from './Binding';

/** Written through `set` so an `ObservableQuaternion` notifies once per sample, not four times */
interface QuaternionSettable extends QuaternionData {
  set: (x: number, y: number, z: number, w: number) => this;
}

/**
 * Renormalises each sample, since a blend of unit quaternions comes out shorter and would scale the transform
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
