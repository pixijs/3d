import { Track } from './Track';
import type { TrackOptions } from './Track';

/**
 * Track for scalar numeric animation values
 *
 * Use this when manually authoring an animation for a one-component
 * property such as visibility masks or custom scalar channels.
 * @category animation
 * @advanced
 */
export class NumberTrack extends Track {
  /**
   * @param options - Keyframe data and binding label for the scalar channel
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
