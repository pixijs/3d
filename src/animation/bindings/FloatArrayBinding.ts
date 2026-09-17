import { Binding } from './Binding';

/**
 * Copies sampled values into an array-like numeric buffer
 * @internal
 */
export class FloatArrayBinding extends Binding {
  constructor(private readonly _target: Float32Array | Float64Array | number[]) {
    super();
  }

  public apply(value: Float32Array): void {
    const arr = this._target;
    const len = value.length;
    for (let i = 0; i < len; i++) {
      arr[i] = value[i];
    }
  }
}
