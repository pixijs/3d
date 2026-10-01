import { Track } from './Track';
import type { TrackOptions } from './Track';

/**
 * Track for a number property, such as a node's `x` or a number field on your own subclass
 * @category animation
 * @advanced
 */
export class NumberTrack extends Track {
  /**
   * @param options - Keyframes and target label
   */
  constructor(options: Omit<TrackOptions, 'valueSize'>) {
    super({ ...options, valueSize: 1 });
  }

  /**
   * Blends a sample in with the single-component lerp unrolled
   * @param values - The running weighted average, updated in place
   * @param sample - The freshly evaluated value to blend in
   * @param t - Blend factor for `sample` against `values`
   */
  public override blendInto(values: Float32Array, sample: Float32Array, t: number): void {
    values[0] += (sample[0] - values[0]) * t;
  }
}
