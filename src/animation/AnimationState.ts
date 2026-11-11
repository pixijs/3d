import type { Animation } from './Animation';
import type { AnimationPlayer } from './AnimationPlayer';
import type { PropertyAccumulator } from './PropertyAccumulator';

/**
 * Playback state for a single {@link Animation} on an {@link AnimationPlayer}
 *
 * {@link AnimationPlayer#play} and {@link AnimationPlayer#getState} return one. Use it to control
 * playback, looping, speed and blend weight. The playback methods follow pixi's `AnimatedSprite`:
 * {@link AnimationState#stop | stop()} freezes in place and {@link AnimationState#play | play()}
 * resumes from there.
 * @example
 * ```ts
 * const walk = model.player.play('walk');
 *
 * walk.animationSpeed = 0.5;
 * walk.stop(); // freeze at the current pose
 * walk.play(); // resume from the same time
 * walk.gotoAndStop(0); // rewind and show the first pose
 * ```
 * @category animation
 * @standard
 */
export class AnimationState {
  /**
   * Animation this state plays
   * @example
   * ```ts
   * walk.gotoAndStop(walk.animation.duration);
   * ```
   */
  public readonly animation: Animation;
  /**
   * Player that owns this state
   * @example
   * ```ts
   * attack.onComplete = () => attack.player.play('idle');
   * ```
   */
  public readonly player: AnimationPlayer;
  /**
   * Current playback time in seconds
   *
   * Writing it moves the playhead without applying the pose. Use
   * {@link AnimationState#gotoAndStop | gotoAndStop()} to seek and show the pose at once.
   * @example
   * ```ts
   * const progress = walk.time / walk.animation.duration;
   * ```
   * @default 0
   */
  public time: number = 0;
  /**
   * Playback speed multiplier; negative values play backwards
   * @example
   * ```ts
   * walk.animationSpeed = 2;
   * rewind.animationSpeed = -1;
   * ```
   * @default 1
   */
  public animationSpeed: number = 1;
  /**
   * Whether playback wraps around at the animation's ends
   * @example
   * ```ts
   * const jump = player.play('jump');
   *
   * jump.loop = false;
   * ```
   * @default true
   */
  public loop: boolean = true;
  /**
   * Share of the blend when several playing states drive the same property through tracks with the
   * same label
   *
   * Weights are relative: at 1 and 3, the property ends up a quarter one state and three quarters
   * the other. They don't fade a state against the rest pose; a state that is the only one driving
   * a property applies in full at any weight above 0. At 0 the state keeps advancing but writes
   * nothing.
   * @example
   * ```ts
   * const walk = player.play('walk');
   * const run = player.play('run');
   *
   * walk.weight = 1 - speed;
   * run.weight = speed;
   * ```
   * @default 1
   */
  public weight: number = 1;
  /**
   * Called once when a non-looping state reaches its end
   *
   * The state has already stopped, holding its final pose, so the callback can
   * start the next animation.
   * @example
   * ```ts
   * const attack = player.getState('attack');
   *
   * attack.loop = false;
   * attack.onComplete = () => player.play('idle');
   * attack.gotoAndPlay(0);
   * ```
   * @default null
   */
  public onComplete: (() => void) | null = null;
  /**
   * Called each time a looping state wraps around its duration
   * @example
   * ```ts
   * walk.onLoop = () => footsteps.play();
   * ```
   * @default null
   */
  public onLoop: (() => void) | null = null;

  private _playing: boolean = false;
  private _completed: boolean = false;
  private _looped: boolean = false;
  private readonly _trackIndices: Int32Array;
  /** @internal */
  public _accumulators: PropertyAccumulator[] = [];

  /** Grown by the constructor to the widest track, since a morph weights track can exceed 4 components */
  private static _scratchBuffer = new Float32Array(4);

  /** @internal */
  constructor(player: AnimationPlayer, animation: Animation) {
    this.player = player;
    this.animation = animation;

    this._trackIndices = new Int32Array(animation.tracks.length);

    for (let i = 0; i < animation.tracks.length; i++) {
      if (animation.tracks[i].valueSize > AnimationState._scratchBuffer.length) {
        AnimationState._scratchBuffer = new Float32Array(animation.tracks[i].valueSize);
      }
    }
  }

  /**
   * Whether this state is advancing on its player's updates
   * @example
   * ```ts
   * if (!attack.playing) attack.gotoAndPlay(0);
   * ```
   */
  public get playing(): boolean {
    return this._playing;
  }

  /**
   * Starts or resumes playback from the current {@link AnimationState#time | time}
   *
   * A one-shot animation that already finished completes again on the next update; use
   * {@link AnimationState#gotoAndPlay | gotoAndPlay(0)} to restart it, or
   * `gotoAndPlay(animation.duration)` for one a negative `animationSpeed` plays backwards. Does
   * nothing once the owning player is destroyed.
   * @example
   * ```ts
   * pauseButton.on('pointertap', () => (walk.playing ? walk.stop() : walk.play()));
   * ```
   * @returns This state for chaining
   */
  public play(): this {
    if (this._playing || this.player.destroyed) return this;

    this._playing = true;
    this.player._activate(this);

    return this;
  }

  /**
   * Stops playback, holding the current time and pose
   *
   * To rewind, call {@link AnimationState#gotoAndStop | gotoAndStop(0)}.
   * @example
   * ```ts
   * player.getState('walk').stop();
   * ```
   * @returns This state for chaining
   */
  public stop(): this {
    if (!this._playing) return this;

    this._playing = false;
    this.player._deactivate();

    return this;
  }

  /**
   * Jumps to a time and starts playing from there
   * @example
   * ```ts
   * attackButton.on('pointertap', () => attack.gotoAndPlay(0));
   * ```
   * @param time - Playback time in seconds
   * @returns This state for chaining
   */
  public gotoAndPlay(time: number): this {
    this.time = time;

    return this.play();
  }

  /**
   * Stops playback at a time and applies that pose to the target right away
   *
   * The pose is this state's alone, not blended with others; a state still playing overwrites
   * the properties it drives on the next update. Does nothing once the owning player is destroyed.
   * @example
   * ```ts
   * slider.on('change', (value: number) => walk.gotoAndStop(value * walk.animation.duration));
   * ```
   * @param time - Playback time in seconds
   * @returns This state for chaining
   */
  public gotoAndStop(time: number): this {
    if (this.player.destroyed) return this;

    this.stop();
    this.time = time;
    this._applyPose();

    return this;
  }

  /**
   * A one-shot state that runs past an end stops but still samples this frame, so its end pose holds
   * @internal
   */
  public _update(seconds: number): void {
    if (!this._playing) return;

    const duration = this.animation.duration;
    let time = this.time + seconds * this.animationSpeed;

    if (time >= duration || time < 0) {
      if (!this.loop) {
        time = time < 0 ? 0 : duration;
        this._completed = true;
        this.stop();
      } else if (duration > 0) {
        time %= duration;
        if (time < 0) time += duration;
        this._looped = true;
      } else {
        time = 0;
      }
    }

    this.time = time;

    const weight = this.weight;
    if (weight === 0) return;

    const scratch = AnimationState._scratchBuffer;
    const tracks = this.animation.tracks;
    const accumulators = this._accumulators;
    const trackIndices = this._trackIndices;

    if (accumulators.length === 0) return;

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const acc = accumulators[i];

      if (!acc) continue;

      const lastIndex = trackIndices[i];

      if (!acc.dirty) {
        trackIndices[i] = track.evaluate(this.time, lastIndex, acc.values);
        acc.weight = weight;
        acc.dirty = true;
      } else {
        trackIndices[i] = track.evaluate(this.time, lastIndex, scratch);

        const newWeight = acc.weight + weight;
        if (newWeight > 0) {
          track.blendInto(acc.values, scratch, weight / newWeight);
        }
        acc.weight = newWeight;
      }
    }
  }

  /** @internal */
  public _emitCallbacks(): void {
    if (this._looped) {
      this._looped = false;
      this.onLoop?.();
    }

    if (this._completed) {
      this._completed = false;
      this.onComplete?.();
    }
  }

  private _applyPose(): void {
    this.player._bind(this);

    const tracks = this.animation.tracks;
    const accumulators = this._accumulators;
    const trackIndices = this._trackIndices;

    for (let i = 0; i < tracks.length; i++) {
      const acc = accumulators[i];

      trackIndices[i] = tracks[i].evaluate(this.time, trackIndices[i], acc.values);
      acc.binding.apply(acc.values);
    }
  }
}
