/**
 * Applies sampled animation values to a concrete target
 *
 * Bindings keep the animation player independent from the shape of each target,
 * so sampled track values can be accumulated once and applied through a small,
 * allocation-free contract.
 * @internal
 */
export abstract class Binding {
  /**
   * Writes the sampled value into the bound target
   * @param value - The sampled track value to apply
   * @internal
   */
  public abstract apply(value: Float32Array): void;
}
