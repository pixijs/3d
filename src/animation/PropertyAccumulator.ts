import type { Binding } from './bindings/Binding';

/** @internal */
export class PropertyAccumulator {
  public binding: Binding;
  public values: Float32Array;
  public weight: number = 0;
  /** `false` until a state samples into `values` this update, so the first one overwrites rather than blends */
  public dirty: boolean = false;

  constructor(binding: Binding, valueSize: number) {
    this.binding = binding;
    this.values = new Float32Array(valueSize);
  }
}
