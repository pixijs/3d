import { Track } from './Track';
import type { TrackOptions } from './Track';

/**
 * Track for three-component point animation values
 *
 * Use this when manually authoring translation, scale, or other Vector3
 * animation channels.
 * @category animation
 * @advanced
 */
export class Vector3Track extends Track {
  /**
   * @param options - Keyframe data and binding label for the point channel
   */
  constructor(options: Omit<TrackOptions, 'valueSize'>) {
    super({ ...options, valueSize: 3 });
  }

  /**
   * Blends a sample in with the three-wide lerp unrolled
   * @param values - The running weighted average, updated in place
   * @param sample - The freshly evaluated value to blend in
   * @param t - Blend factor for `sample` against `values`
   */
  public override blendInto(values: Float32Array, sample: Float32Array, t: number): void {
    values[0] += (sample[0] - values[0]) * t;
    values[1] += (sample[1] - values[1]) * t;
    values[2] += (sample[2] - values[2]) * t;
  }
}
