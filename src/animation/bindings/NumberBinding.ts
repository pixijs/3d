import { Binding } from './Binding';

/**
 * Applies scalar samples to a numeric property on an object target
 * @internal
 */
export class NumberBinding<TTarget extends object = object> extends Binding {
  constructor(
    private readonly _target: TTarget,
    private readonly _key: keyof TTarget,
  ) {
    super();
  }

  public apply(value: Float32Array): void {
    this._target[this._key] = value[0] as TTarget[keyof TTarget];
  }
}
