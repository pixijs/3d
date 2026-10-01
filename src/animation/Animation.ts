import type { Track } from './tracks/Track';

/**
 * Options for creating an animation
 * @example
 * ```ts
 * const options: AnimationOptions = {
 *   label: 'bob',
 *   tracks: [
 *     new Vector3Track({ label: 'Crate.position', times: [0, 0.5, 1], values: [0, 0, 0, 0, 1, 0, 0, 0, 0] }),
 *   ],
 * };
 * ```
 * @category animation
 * @standard
 */
export interface AnimationOptions {
  /**
   * Label {@link AnimationPlayer#addAnimations} registers this animation under when given an array
   * @example
   * ```ts
   * player.addAnimations([new Animation({ label: 'wave', tracks })]);
   * player.play('wave');
   * ```
   */
  label: string;
  /**
   * Tracks the animation plays, each driving one property
   * @example
   * ```ts
   * const shake = new Animation({
   *   label: 'shake',
   *   tracks: [new NumberTrack({ label: 'Camera.x', times: [0, 0.1, 0.2], values: [0, 0.2, 0] })],
   * });
   * ```
   */
  tracks?: readonly Track[];
  /**
   * Length in seconds; left out, it is the time of the last keyframe across all tracks
   *
   * Set it past the last keyframe to hold the final pose before the animation loops.
   * @example
   * ```ts
   * const blink = new Animation({
   *   label: 'blink',
   *   tracks: [
   *     new Vector3Track({ label: 'Eyelid.scale', times: [0, 0.1, 0.2], values: [1, 1, 1, 1, 0.1, 1, 1, 1, 1] }),
   *   ],
   *   duration: 4,
   * });
   * ```
   */
  duration?: number;
}

/**
 * A named set of keyframe tracks, holding no playback state
 *
 * A {@link Model3D} loaded from glTF comes with its animations already registered on its
 * {@link Model3D#player | player}. Build one yourself to animate in code, then register it on an
 * {@link AnimationPlayer}. One animation can play on many players at once; each player keeps its
 * own {@link AnimationState} for it.
 * @example
 * ```ts
 * const crate = new Container3D({ label: 'Crate' });
 * const bob = new Animation({
 *   label: 'bob',
 *   tracks: [
 *     new Vector3Track({ label: 'Crate.position', times: [0, 0.5, 1], values: [0, 0, 0, 0, 1, 0, 0, 0, 0] }),
 *   ],
 * });
 *
 * const player = new AnimationPlayer({ target: crate, animations: [bob], autoPlay: 'bob' });
 * ```
 * @category animation
 * @standard
 */
export class Animation {
  /**
   * Label {@link AnimationPlayer#addAnimations} registers this animation under when given an array
   * @example
   * ```ts
   * player.addAnimations([bob]);
   * player.play(bob.label);
   * ```
   */
  public label: string;
  /**
   * Tracks this animation plays
   * @advanced
   */
  public readonly tracks: readonly Track[];
  /**
   * Length in seconds
   * @example
   * ```ts
   * const walk = player.getAnimation('walk')!;
   *
   * player.getState(walk).gotoAndStop(walk.duration / 2);
   * ```
   */
  public duration = 0;

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
