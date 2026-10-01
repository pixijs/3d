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
   * Share of the blend when several playing states drive the same property
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

  /**
   * Scratch for the blend in `_update`, shared by every state and sized to the widest track
   *
   * Morph weight tracks carry one component per target, which can exceed any built-in value type.
   * A scratch too short reads back `undefined` past its end and poisons the blend with NaN.
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
   * {@link AnimationState#gotoAndPlay | gotoAndPlay(0)} to restart it.
   *
   * Does nothing once the owning player is destroyed, so a state kept from before
   * cannot put the dead player back on the ticker.
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
   * The state stops blending, and the player releases its ticker once nothing is playing.
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
   * the properties it drives on the next update. Does nothing once the owning player is
   * destroyed, whose target nodes are gone.
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
   * Advances this state and adds its sampled track values to the player's accumulators
   *
   * The first state to write a property this frame samples straight into the accumulator. Each
   * later one samples into the shared scratch and lerps in by its share of the weight so far,
   * which leaves the accumulator holding the weighted average of every sample, whatever order the
   * states ran in.
   *
   * A one-shot state that runs past either end clamps to it and stops, but still samples this
   * frame, so its end pose is applied and holds.
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
