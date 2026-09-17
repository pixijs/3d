import type { Track } from './tracks/Track';

/**
 * Options for creating an animation
 * @category animation
 * @standard
 */
export interface AnimationOptions {
  /** Label an {@link AnimationPlayer} registers this animation under */
  label: string;
  /**
   * Keyframe tracks evaluated by the animation
   *
   * Tracks are expected to use sorted keyframe times. When `duration` is not
   * supplied, the duration is derived from the last keyframe of each track.
   */
  tracks?: readonly Track[];
  /** Duration in seconds; calculated from the tracks when omitted */
  duration?: number;
}

/**
 * A reusable animation made up of keyframe tracks
 *
 * `Animation` stores sampled animation data only. Playback state, looping,
 * blending, and target binding are handled by {@link AnimationPlayer} and
 * {@link AnimationState}.
 * @category animation
 * @standard
 */
export class Animation {
  /** Label used for lookup by animation players */
  public label: string;
  /** Keyframe tracks evaluated when this animation is played */
  public readonly tracks: readonly Track[];
  /** Duration in seconds */
  public duration: number;

  /**
   * @param options - Label, tracks, and optional explicit duration for the animation
   */
  constructor(options: AnimationOptions) {
    this.label = options.label;
    this.tracks = options.tracks || [];
    this.duration = options.duration ?? this._getDuration();
  }

  private _getDuration(): number {
    let maxTime = 0;
    for (let i = 0; i < this.tracks.length; i++) {
      const track = this.tracks[i];
      const trackTime = track.times[track.times.length - 1];
      if (trackTime > maxTime) {
        maxTime = trackTime;
      }
    }

    return maxTime;
  }
}
