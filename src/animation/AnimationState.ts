import type { Animation } from './Animation';
import type { AnimationPlayer, PropertyAccumulator } from './AnimationPlayer';

/**
 * Playback state for a single {@link Animation} on an {@link AnimationPlayer}
 *
 * Animation states are returned by {@link AnimationPlayer#play} and
 * {@link AnimationPlayer#getState}. Use them to control playback,
 * looping, speed, and blend weight. The playback methods follow pixi's
 * `AnimatedSprite`: {@link AnimationState#stop | stop()} freezes in place and
 * {@link AnimationState#play | play()} resumes from there.
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
  /** Animation this state plays */
  public readonly animation: Animation;
  /** Player that owns this state */
  public readonly player: AnimationPlayer;
  /**
   * Current playback time in seconds
   *
   * Writing it moves the playhead without applying the pose. Use
   * {@link AnimationState#gotoAndStop | gotoAndStop()} to seek and show the pose at once.
   * @default 0
   */
  public time: number = 0;
  /**
   * Playback speed multiplier; negative values play backwards
   * @default 1
   */
  public animationSpeed: number = 1;
  /**
   * Whether playback wraps at the animation's duration
   * @default true
   */
  public loop: boolean = true;
  /**
   * Relative blend weight used when multiple playing states target the same property
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
   * @default null
   */
  public onLoop: (() => void) | null = null;

  private _playing: boolean = false;
  private _completed: boolean = false;
  private _looped: boolean = false;
  private readonly _trackIndices: Int32Array;
  /** @internal */
  public _accumulators: PropertyAccumulator[] = [];

  /**
   * Shared scratch buffer, sized to the widest track so sampling never allocates
   *
   * Only the blend path uses it: a state writing a property an earlier state
   * already wrote samples here, then blends into the accumulator; the first writer
   * samples straight into the accumulator. Morph weight tracks carry one component
   * per target, which can exceed any built-in value type (a truncated scratch reads
   * back `undefined` past its end and poisons the sampled values with NaN).
   */
  private static _scratchBuffer = new Float32Array(4);

  /**
   * States come from {@link AnimationPlayer#getState}, which keeps one per animation
   * @param player - Player that owns this state
   * @param animation - Animation this state plays
   * @internal
   */
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

  /** Whether this state is advancing on its player's updates */
  public get playing(): boolean {
    return this._playing;
  }

  /**
   * Starts or resumes playback from the current {@link AnimationState#time | time}
   *
   * Does nothing once the owning player is destroyed, so a state kept from before
   * cannot put the dead player back on the ticker.
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
   * The state stops blending, and the player releases its ticker once nothing is playing.
   * To rewind, call {@link AnimationState#gotoAndStop | gotoAndStop(0)}.
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
   * Does nothing once the owning player is destroyed, whose target nodes are gone.
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
   * Advances this state and accumulates sampled track values
   *
   * Only {@link AnimationPlayer#update} drives this; it applies the accumulated values afterwards.
   * @param seconds - Time to advance before applying {@link AnimationState#animationSpeed}
   * @internal
   */
  public _update(seconds: number): void {
    if (!this._playing) return;

    const duration = this.animation.duration;
    let time = this.time + seconds * this.animationSpeed;

    if (time >= duration || time < 0) {
      if (!this.loop) {
        // Clamp so this frame samples the end pose, then stop: the pose holds after.
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
        // First writer this frame — sample straight into the accumulator. The
        // shared scratch buffer only earns its keep when a later state blends.
        trackIndices[i] = track.evaluate(this.time, lastIndex, acc.values);
        acc.weight = weight;
        acc.dirty = true;
      } else {
        // A prior state already wrote acc.values, so sample into scratch and blend
        // the fresh value into the running weighted average.
        trackIndices[i] = track.evaluate(this.time, lastIndex, scratch);

        const newWeight = acc.weight + weight;
        if (newWeight > 0) {
          track.blendInto(acc.values, scratch, weight / newWeight);
        }
        acc.weight = newWeight;
      }
    }
  }

  /**
   * Calls the callbacks `_update` flagged, once the player has applied every pose
   * @internal
   */
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

  /** Samples every track at the current time and writes the result straight to the targets */
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
