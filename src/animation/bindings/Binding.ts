/**
 * Writes sampled animation values to one target property
 *
 * The player blends every property as plain floats; a binding is the one step that knows the
 * target's shape, so applying a frame is a single allocation-free call per property.
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
