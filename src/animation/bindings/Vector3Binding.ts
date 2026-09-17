import type { PointLike3D } from '../../math/vector/PointLike3D';
import { Binding } from './Binding';

/**
 * Applies three-component samples to objects that expose mutable point data
 * @internal
 */
export class Vector3Binding extends Binding {
  constructor(private readonly _target: PointLike3D) {
    super();
  }

  public apply(value: Float32Array): void {
    this._target.set(value[0], value[1], value[2]);
  }
}
