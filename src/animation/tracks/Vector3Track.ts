import { Track } from './Track';
import type { TrackOptions } from './Track';

/**
 * Track for a three-component vector property, such as a node's `position` or `scale`
 * @category animation
 * @advanced
 */
export class Vector3Track extends Track {
  /**
   * @param options - Keyframes and target label
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

  /**
   * Writes the value between two keyframes with the three-wide `'LINEAR'` lerp unrolled
   * @param index - Keyframe at or before the sample time
   * @param nextIndex - Keyframe after it
   * @param t - How far the sample sits between the two, from 0 to 1
   * @param duration - Seconds between the two keyframes, which scales the cubic tangents
   * @param target - Receives three numbers
   */
  protected override interpolate(
    index: number,
    nextIndex: number,
    t: number,
    duration: number,
    target: Float32Array | number[],
  ): void {
    if (this.interpolation === 'CUBICSPLINE') {
      super.interpolate(index, nextIndex, t, duration, target);

      return;
    }

    const values = this.values;
    const a = index * 3;
    const b = nextIndex * 3;
    const a0 = values[a];
    const a1 = values[a + 1];
    const a2 = values[a + 2];

    target[0] = a0 + (values[b] - a0) * t;
    target[1] = a1 + (values[b + 1] - a1) * t;
    target[2] = a2 + (values[b + 2] - a2) * t;
  }
}
