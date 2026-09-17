import { Quaternion } from '../../math/rotation/Quaternion';
import { Track } from './Track';
import type { TrackOptions } from './Track';

/**
 * Track for quaternion rotation animation values
 *
 * Quaternion tracks use spherical interpolation for linear samples and normalize
 * cubic spline samples after evaluation.
 * @category animation
 * @advanced
 */
export class QuaternionTrack extends Track {
  /**
   * @param options - Keyframe data and binding label for the quaternion channel
   */
  constructor(options: Omit<TrackOptions, 'valueSize'>) {
    super({ ...options, valueSize: 4 });
  }

  /**
   * Blends a sample in, aligning its hemisphere with the running average first
   *
   * `q` and `-q` encode the same rotation, so a component-wise lerp between
   * opposite hemispheres cancels toward zero and explodes the pose for a frame.
   * Flipping the incoming sample to match keeps the shortest arc.
   * @param values - The running weighted average, updated in place
   * @param sample - The freshly evaluated quaternion to blend in
   * @param t - Blend factor for `sample` against `values`
   */
  public override blendInto(values: Float32Array, sample: Float32Array, t: number): void {
    const v0 = values[0];
    const v1 = values[1];
    const v2 = values[2];
    const v3 = values[3];

    let s0 = sample[0];
    let s1 = sample[1];
    let s2 = sample[2];
    let s3 = sample[3];

    if (v0 * s0 + v1 * s1 + v2 * s2 + v3 * s3 < 0) {
      s0 = -s0;
      s1 = -s1;
      s2 = -s2;
      s3 = -s3;
    }

    values[0] = v0 + (s0 - v0) * t;
    values[1] = v1 + (s1 - v1) * t;
    values[2] = v2 + (s2 - v2) * t;
    values[3] = v3 + (s3 - v3) * t;
  }

  protected interpolate(
    index: number,
    nextIndex: number,
    t: number,
    duration: number,
    target: Float32Array | number[],
  ): void {
    if (this.interpolation === 'CUBICSPLINE') {
      super.interpolate(index, nextIndex, t, duration, target);

      const x = target[0];
      const y = target[1];
      const z = target[2];
      const w = target[3];
      const invLen = 1.0 / Math.sqrt(x * x + y * y + z * z + w * w);
      target[0] *= invLen;
      target[1] *= invLen;
      target[2] *= invLen;
      target[3] *= invLen;
    } else {
      // SLERP (Linear for Quaternions)
      Quaternion.slerpFlat(
        target as number[],
        0,
        this.values as unknown as number[], // slerpFlat expects number[] but Float32Array works in JS
        index * 4,
        this.values as unknown as number[],
        nextIndex * 4,
        t,
      );
    }
  }
}
