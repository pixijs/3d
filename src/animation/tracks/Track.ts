/**
 * How a track fills the time between two keyframes
 *
 * - `'LINEAR'` blends straight from one keyframe to the next; a {@link QuaternionTrack} slerps.
 * - `'STEP'` holds each keyframe until the next one.
 * - `'CUBICSPLINE'` follows a smooth curve shaped by tangents stored with each keyframe;
 *   {@link TrackOptions#values} has the layout.
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
  /** Keyframe times in seconds, in ascending order */
  times: number[] | Float32Array;
  /**
   * Keyframe values, `valueSize` numbers per keyframe, in the order of `times`
   *
   * A `'CUBICSPLINE'` track stores three groups per keyframe instead: in-tangent, value and
   * out-tangent, each `valueSize` long. Tangents are rates of change per second, as glTF stores them.
   */
  values: number[] | Float32Array;
  /**
   * Interpolation algorithm used between keyframes
   * @default 'LINEAR'
   */
  interpolation?: InterpolationMode;
  /**
   * The property this track drives, as `'<node>.<property>'`, such as `'Hips.quaternion'`
   *
   * The player splits the label at its last `.` and looks for a node with that label, or a bone
   * of a skinned mesh with that name, in the subtree of {@link AnimationPlayerOptions#target}.
   * On a bone the property is `position`, `quaternion` or `scale`. On a node it is a `Vector3` or
   * `ObservableVector3`, quaternion, number or numeric array property, such as `position`, `x` or
   * `weights`. A label that matches nothing, or a property of another type, is ignored without a
   * warning.
   *
   * Tracks loaded from glTF name their node by its index in the file, which only the player of a
   * {@link Model3D} resolves.
   */
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
 * Kept out of {@link Track#evaluate} so V8 still inlines the forward search that forward playback takes
 * @param times - Keyframe times, with `times[0] < time < times[after]`
 * @param time - Time in seconds
 * @param after - A keyframe index past `time`
 */
function bisectKeyframe(times: Float32Array, time: number, after: number): number {
  let low = 0;
  let high = after;

  while (high - low > 1) {
    const mid = (low + high) >> 1;

    if (times[mid] <= time) low = mid;
    else high = mid;
  }

  return low;
}

/**
 * Keyframes for one animated property
 *
 * The glTF loader builds tracks for you. Build them yourself to author an animation in code, and
 * pass them to {@link AnimationOptions#tracks}. Use `Track` itself for numeric arrays such as
 * morph-target weights, and {@link NumberTrack}, {@link Vector3Track} or {@link QuaternionTrack}
 * for numbers, vectors and rotations.
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
  /** The property this track drives; {@link TrackOptions#label} has the format */
  public label: string;
  /** Keyframe times in seconds */
  public times: Float32Array;
  /** Keyframe values; {@link TrackOptions#values} has the layout */
  public values: Float32Array;
  /** Interpolation algorithm used between keyframes */
  public interpolation: InterpolationMode;
  /** Number of numeric components in each sampled value */
  public readonly valueSize: number = 0;
  /**
   * @param options - Keyframes, target label and value size
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
   * The player calls it every frame while two or more playing states drive the same property.
   * Override it where a component-wise lerp is wrong for the value, as {@link QuaternionTrack} does.
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
   * Samples the track at a time, holding the first or last keyframe outside their range
   * @param time - Time in seconds
   * @param index - Keyframe index this returned last time, which shortens the search; `0` always works
   * @param target - Receives `valueSize` numbers
   * @returns The keyframe index to pass back as `index` next time
   */
  public evaluate(time: number, index: number, target: Float32Array | number[]): number {
    const times = this.times;
    const values = this.values;
    const len = times.length;
    const valueSize = this.valueSize;

    if (time <= times[0]) {
      if (this.interpolation === 'CUBICSPLINE') {
        const firstValueOffset = valueSize;
        for (let i = 0; i < valueSize; i++) target[i] = values[firstValueOffset + i];
      } else {
        for (let i = 0; i < valueSize; i++) target[i] = values[i];
      }
      return 0;
    }

    if (time >= times[len - 1]) {
      if (this.interpolation === 'CUBICSPLINE') {
        const lastValueOffset = (len - 1) * 3 * valueSize + valueSize;
        for (let i = 0; i < valueSize; i++) target[i] = values[lastValueOffset + i];
      } else {
        const offset = (len - 1) * valueSize;
        for (let i = 0; i < valueSize; i++) target[i] = values[offset + i];
      }
      return len - 2;
    }

    if (times[index] > time) index = bisectKeyframe(times, time, index);
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

  /**
   * Writes the value between two keyframes for `'LINEAR'` and `'CUBICSPLINE'`; {@link Track#evaluate} handles `'STEP'`
   * @param index - Keyframe at or before the sample time
   * @param nextIndex - Keyframe after it
   * @param t - How far the sample sits between the two, from 0 to 1
   * @param duration - Seconds between the two keyframes, which scales the cubic tangents
   * @param target - Receives `valueSize` numbers
   */
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
