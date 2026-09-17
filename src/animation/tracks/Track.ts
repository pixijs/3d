/**
 * Interpolation algorithm used between keyframes in a track
 * @category animation
 * @advanced
 */
export type InterpolationMode = 'LINEAR' | 'STEP' | 'CUBICSPLINE';

/**
 * Options for constructing a keyframe track
 * @category animation
 * @advanced
 */
export interface TrackOptions {
  /** Keyframe times in seconds */
  times: number[] | Float32Array;
  /** Packed keyframe values matching the track's value size */
  values: number[] | Float32Array;
  /**
   * Interpolation algorithm used between keyframes
   * @default 'LINEAR'
   */
  interpolation?: InterpolationMode;
  /** Binding label resolved by the animation player */
  label: string;
  /**
   * Number of numeric components in each keyframe value, such as the morph-target
   * count of a weights track
   *
   * {@link NumberTrack}, {@link Vector3Track} and {@link QuaternionTrack} set it for you.
   * @default 1
   */
  valueSize?: number;
}

/**
 * Sampled animation data for a property of any width
 *
 * Tracks are advanced authoring primitives for manually creating animations.
 * Loaders usually create them for you, but custom animations can provide
 * tracks directly through {@link AnimationOptions#tracks}. Use `Track` itself for
 * numeric arrays such as morph-target weights, and the fixed-width subclasses for
 * scalars, points, and rotations.
 * @example
 * ```ts
 * const weights = new Track({
 *   label: 'Face.weights',
 *   times: [0, 1],
 *   values: [0, 0, 1, 0.5],
 *   valueSize: 2,
 * });
 * ```
 * @category animation
 * @advanced
 */
export class Track {
  /** Binding label resolved by the animation player */
  public label: string;
  /** Keyframe times in seconds */
  public times: Float32Array;
  /** Packed keyframe values matching {@link Track#valueSize} */
  public values: Float32Array;
  /** Interpolation algorithm used between keyframes */
  public interpolation: InterpolationMode;
  /** Number of numeric components in each sampled value */
  public readonly valueSize: number;
  /**
   * @param options - Track data, binding label, and value size
   */
  constructor(options: TrackOptions) {
    this.label = options.label;
    this.times = options.times instanceof Float32Array ? options.times : new Float32Array(options.times);
    this.values = options.values instanceof Float32Array ? options.values : new Float32Array(options.values);
    this.interpolation = options.interpolation || 'LINEAR';
    this.valueSize = options.valueSize ?? 1;
  }

  /**
   * Blends a freshly sampled value into a running weighted average
   *
   * Runs once per track for every blended animation state, every frame, so it
   * is on the hot path for every animated skeleton. Subclasses override it to
   * unroll their fixed width, which beats this generic loop even with the
   * virtual dispatch, and to add whatever their representation needs beyond a
   * component-wise lerp — {@link QuaternionTrack} aligns hemispheres first.
   * @param values - The running weighted average, updated in place
   * @param sample - The freshly evaluated value to blend in
   * @param t - Blend factor for `sample` against `values`
   */
  public blendInto(values: Float32Array, sample: Float32Array, t: number): void {
    const size = this.valueSize;

    for (let k = 0; k < size; k++) {
      values[k] += (sample[k] - values[k]) * t;
    }
  }

  /**
   * Evaluates the track at the given time
   * @param time - Current animation time in seconds
   * @param index - Keyframe index from the previous update, used as a search hint
   * @param target - Buffer to write the result into
   * @returns The updated keyframe index to be stored for the next frame
   */
  public evaluate(time: number, index: number, target: Float32Array | number[]): number {
    const times = this.times;
    const values = this.values;
    const len = times.length;
    const valueSize = this.valueSize;

    // Handle boundaries
    if (time <= times[0]) {
      if (this.interpolation === 'CUBICSPLINE') {
        const offset = valueSize; // (0 * valueSize * 3) + valueSize
        for (let i = 0; i < valueSize; i++) target[i] = values[offset + i];
      } else {
        for (let i = 0; i < valueSize; i++) target[i] = values[i];
      }
      return 0;
    }

    if (time >= times[len - 1]) {
      if (this.interpolation === 'CUBICSPLINE') {
        // Last keyframe: (len-1) * 3 * valueSize + valueSize
        const offset = (len - 1) * 3 * valueSize + valueSize;
        for (let i = 0; i < valueSize; i++) target[i] = values[offset + i];
      } else {
        const offset = (len - 1) * valueSize;
        for (let i = 0; i < valueSize; i++) target[i] = values[offset + i];
      }
      return len - 2;
    }

    // Search
    if (times[index] > time) index = 0;
    while (index < len - 1 && times[index + 1] <= time) index++;

    const nextIndex = index + 1;

    if (this.interpolation === 'STEP') {
      const offset = index * valueSize;
      for (let i = 0; i < valueSize; i++) target[i] = values[offset + i];
      return index;
    }

    const t1 = times[index];
    const t2 = times[nextIndex];
    const duration = t2 - t1;
    const t = (time - t1) / duration;

    this.interpolate(index, nextIndex, t, duration, target);

    return index;
  }

  protected interpolate(
    index: number,
    nextIndex: number,
    t: number,
    duration: number,
    target: Float32Array | number[],
  ): void {
    const values = this.values;
    const valueSize = this.valueSize;

    if (this.interpolation === 'CUBICSPLINE') {
      const stride = valueSize * 3;
      const offset1 = index * stride;
      const offset2 = nextIndex * stride;

      const t2 = t * t;
      const t3 = t2 * t;

      const s2 = 3 * t2 - 2 * t3;
      const s3 = t3 - t2;
      const s0 = 1 - s2;
      const s1 = s3 - t2 + t;

      for (let i = 0; i < valueSize; i++) {
        const p0 = values[offset1 + valueSize + i];
        const m0 = values[offset1 + valueSize * 2 + i] * duration;
        const m1 = values[offset2 + i] * duration;
        const p1 = values[offset2 + valueSize + i];

        target[i] = s0 * p0 + s1 * m0 + s2 * p1 + s3 * m1;
      }
    } else {
      // LINEAR
      const offset1 = index * valueSize;
      const offset2 = nextIndex * valueSize;

      for (let i = 0; i < valueSize; i++) {
        const v1 = values[offset1 + i];
        const v2 = values[offset2 + i];
        target[i] = v1 + (v2 - v1) * t;
      }
    }
  }
}
