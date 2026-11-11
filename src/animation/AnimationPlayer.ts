import { definedProps, Ticker, UPDATE_PRIORITY } from 'pixi.js';

import { Container3D } from '../scene/Container3D';
import { Mesh3D } from '../scene/Mesh3D';
import type { Skeleton } from '../scene/Skeleton';
import type { Animation } from './Animation';
import { AnimationState } from './AnimationState';
import { createBinding } from './bindings/createBinding';
import { PropertyAccumulator } from './PropertyAccumulator';
import type { Track } from './tracks/Track';

/** @internal */
export type AnimationTarget = Container3D | { skeleton: Skeleton; boneIndex: number };

/**
 * Options for creating an animation player
 * @example
 * ```ts
 * const player = new AnimationPlayer({
 *   target: robot,
 *   animations: [walk, run],
 *   autoPlay: 'walk',
 * });
 * ```
 * @category animation
 * @standard
 */
export interface AnimationPlayerOptions {
  /**
   * Root of the hierarchy to animate; tracks find their nodes in its subtree, itself included
   * @example
   * ```ts
   * const player = new AnimationPlayer({ target: robot, animations: [walk] });
   * ```
   */
  target: Container3D;
  /**
   * Animations to register, keyed as {@link AnimationPlayer#addAnimations} describes
   * @example
   * ```ts
   * const player = new AnimationPlayer({ target: robot, animations: { walk, run } });
   * ```
   */
  animations?: Record<string, Animation> | Animation[];
  /**
   * Targets by glTF node index, the node part of a loaded track's label
   * @internal
   */
  nodeMap?: Record<number, AnimationTarget>;
  /**
   * Whether playback advances on {@link Ticker.shared}; see {@link AnimationPlayer#autoUpdate}
   * @example
   * ```ts
   * const player = new AnimationPlayer({ target: robot, animations: [walk], autoUpdate: false });
   *
   * app.ticker.add((ticker) => player.update(ticker));
   * ```
   * @default true
   */
  autoUpdate?: boolean;
  /**
   * Animation to start playing on construction
   *
   * `true` plays the first registered animation, and a string plays the animation
   * registered under that label.
   * @example
   * ```ts
   * const player = new AnimationPlayer({ target: robot, animations: [idle, walk], autoPlay: 'idle' });
   * ```
   * @default false
   */
  autoPlay?: boolean | string;
}

/**
 * Plays animations on a {@link Container3D} and its children
 *
 * A {@link Model3D} loaded with animations already has one as {@link Model3D#player | player}.
 * Build your own to play animations authored in code.
 *
 * Each animation gets one {@link AnimationState} per player, holding its time, speed and weight.
 * Any number can play at once. Where two playing states drive the same property through tracks
 * with the same label, the player blends their values by {@link AnimationState#weight}, which is
 * how crossfades work. Playback
 * advances on {@link Ticker.shared} unless {@link AnimationPlayer#autoUpdate} is off.
 * @example
 * ```ts
 * const player = new AnimationPlayer({ target: robot, animations: [idle, walk] });
 * const walking = player.play('walk');
 *
 * walking.animationSpeed = 1.5;
 * ```
 * @category animation
 * @standard
 */
export class AnimationPlayer {
  /**
   * Defaults for every new `AnimationPlayer`; an option passed as `undefined` keeps its default
   *
   * A {@link Model3D} passes its own `autoUpdate` and `autoPlay`, so its player follows
   * {@link Model3D.defaultOptions} instead.
   * @example
   * ```ts
   * AnimationPlayer.defaultOptions.autoUpdate = false;
   * ```
   */
  public static defaultOptions: Partial<AnimationPlayerOptions> = {
    autoUpdate: true,
    autoPlay: false,
  };

  /**
   * Root of the hierarchy this player animates
   * @advanced
   */
  public readonly target: Container3D;

  private readonly _states: AnimationState[] = [];
  private readonly _stateCache: Map<Animation, AnimationState> = new Map();
  private readonly _animations: Map<string, Animation> = new Map();
  private _animationLabels: string[] | null = null;

  private _autoUpdate: boolean;
  private _isConnectedToTicker: boolean = false;
  /** Set while `update` or `stop` walks `_states`; a state that stops then stays listed until the walk ends */
  private _updating: boolean = false;
  private _destroyed: boolean = false;

  private _accumulators: Record<string, PropertyAccumulator> = {};
  private readonly _accumulatorList: PropertyAccumulator[] = [];
  private readonly _nodeMap?: Record<number, AnimationTarget>;
  private readonly _onTick = (ticker: Ticker): void => {
    this.update(ticker);
  };

  constructor(options: AnimationPlayerOptions) {
    const { target, animations, nodeMap, autoUpdate, autoPlay } = {
      ...AnimationPlayer.defaultOptions,
      ...definedProps(options),
    };

    this.target = target;
    this._nodeMap = nodeMap;
    this._autoUpdate = autoUpdate!;

    if (animations) {
      this.addAnimations(animations);
    }

    const label = autoPlay === true ? this.animationLabels[0] : autoPlay;

    if (typeof label === 'string') this.play(label);
  }

  /**
   * Labels of every registered animation, in registration order
   *
   * Pass one to {@link AnimationPlayer#play} or {@link AnimationPlayer#getState}.
   * @example
   * ```ts
   * for (const label of player.animationLabels) {
   *   addButton(label, () => player.play(label));
   * }
   * ```
   */
  public get animationLabels(): readonly string[] {
    return (this._animationLabels ??= Array.from(this._animations.keys()));
  }

  /**
   * Registers animations for playback
   *
   * Array entries are keyed by each animation's own label. Record entries are keyed
   * by the record property name.
   * @example
   * ```ts
   * player.addAnimations([wave]);
   * player.addAnimations({ cheer: celebrate });
   * player.play('cheer');
   * ```
   * @param animations - Animations to register
   */
  public addAnimations(animations: Record<string, Animation> | Animation[]): void {
    if (Array.isArray(animations)) {
      animations.forEach((animation) => this._animations.set(animation.label, animation));
    } else {
      Object.entries(animations).forEach(([label, animation]) => this._animations.set(label, animation));
    }

    this._animationLabels = null;
  }

  /**
   * Returns a registered animation by label
   * @example
   * ```ts
   * const walkDuration = player.getAnimation('walk')?.duration ?? 0;
   * ```
   * @param label - Registered animation label
   * @returns The animation, or `undefined` when nothing is registered under the label
   */
  public getAnimation(label: string): Animation | undefined {
    return this._animations.get(label);
  }

  /**
   * Starts or resumes an animation from its state's current time
   *
   * Animations already playing carry on and blend with it; call {@link AnimationPlayer#stop}
   * first to switch from one to another. {@link AnimationState#play} covers restarting a one-shot
   * animation that already finished.
   * @example
   * ```ts
   * player.stop();
   * player.play('run');
   * ```
   * @param animation - The animation, or the label it's registered under
   * @returns The playback state for the animation
   */
  public play(animation: Animation | string): AnimationState {
    return this.getState(animation).play();
  }

  /**
   * Stops every playing animation, each holding its current time and pose
   * @example
   * ```ts
   * menu.on('open', () => player.stop());
   * ```
   */
  public stop(): void {
    const states = this._states;
    const updating = this._updating;

    this._updating = true;

    for (let i = 0; i < states.length; i++) {
      states[i].stop();
    }

    this._updating = updating;

    if (!updating) this._removeStopped();
  }

  /**
   * Whether any animation on this player is playing
   * @example
   * ```ts
   * if (!player.playing) player.play('idle');
   * ```
   */
  public get playing(): boolean {
    const states = this._states;

    for (let i = 0; i < states.length; i++) {
      if (states[i].playing) return true;
    }

    return false;
  }

  /**
   * Returns the reusable playback state for an animation without starting playback
   *
   * Each animation has one state per player, created on first request. Throws for a label nothing
   * is registered under; {@link AnimationPlayer#getAnimation} returns `undefined` instead.
   * @example
   * ```ts
   * const jump = player.getState('jump');
   *
   * jump.loop = false;
   * jump.gotoAndPlay(0);
   * ```
   * @param animation - The animation, or the label it's registered under
   * @returns The playback state for the animation
   */
  public getState(animation: Animation | string): AnimationState {
    if (typeof animation === 'string') {
      const registered = this._animations.get(animation);

      if (!registered) {
        throw new Error(`[AnimationPlayer] Animation "${animation}" is not registered.`);
      }

      animation = registered;
    }

    let state = this._stateCache.get(animation);

    if (!state) {
      state = new AnimationState(this, animation);
      this._stateCache.set(animation, state);
    }

    return state;
  }

  /**
   * Whether playback advances on {@link Ticker.shared}
   *
   * Turn it off to drive playback from your own ticker or fixed-step loop with
   * {@link AnimationPlayer#update}.
   * @example
   * ```ts
   * player.autoUpdate = false;
   * app.ticker.add((ticker) => player.update(ticker));
   * ```
   */
  public get autoUpdate(): boolean {
    return this._autoUpdate;
  }

  /**
   * Sets whether playback advances on `Ticker.shared`
   * @param value - `false` to call `update` yourself
   */
  public set autoUpdate(value: boolean) {
    if (value === this._autoUpdate) return;

    this._autoUpdate = value;

    if (!this._autoUpdate) {
      this._disconnectTicker();
    } else if (this.playing) {
      this._connectTicker();
    }
  }

  /** @internal */
  public _activate(state: AnimationState): void {
    if (this._destroyed) return;

    if (this._states.indexOf(state) === -1) {
      this._states.push(state);
    }

    this._bind(state);

    if (this._autoUpdate) {
      this._connectTicker();
    }
  }

  /** @internal */
  public _bind(state: AnimationState): void {
    if (state._accumulators.length > 0) return;

    const tracks = state.animation.tracks;

    for (let i = 0; i < tracks.length; i++) {
      state._accumulators[i] = this._getAccumulator(tracks[i]);
    }
  }

  /** @internal */
  public _deactivate(): void {
    if (!this._updating) this._removeStopped();
  }

  /**
   * Advances all playing states and applies the blended results to their targets
   *
   * Runs every frame from `Ticker.shared` while {@link AnimationPlayer#autoUpdate | autoUpdate}
   * is on and something is playing. Call it yourself when driving playback from your own loop.
   *
   * `onComplete` and `onLoop` callbacks run once every pose is applied, so they see this frame's
   * final pose and may play, stop or seek any state. A state they start begins advancing on the
   * next update.
   * @example
   * ```ts
   * player.autoUpdate = false;
   * app.ticker.add((ticker) => player.update(ticker));
   * ```
   * @param ticker - The ticker driving this update; its `deltaMS` sets how far playback
   *   advances. Omitted, one 60 fps frame is assumed.
   */
  public update(ticker?: Ticker): void {
    const seconds = ticker ? ticker.deltaMS / 1000 : 1 / 60;
    const states = this._states;
    const count = states.length;

    this._updating = true;

    for (let i = 0; i < count; i++) {
      states[i]._update(seconds);
    }

    const accumulators = this._accumulatorList;
    const len = accumulators.length;

    for (let i = 0; i < len; i++) {
      const acc = accumulators[i];

      if (acc.dirty) {
        acc.binding.apply(acc.values);
        acc.dirty = false;
        acc.weight = 0;
      }
    }

    for (let i = 0; i < count; i++) {
      states[i]._emitCallbacks();

      if (this._destroyed) return;
    }

    this._updating = false;
    this._removeStopped();
  }

  /**
   * Whether {@link AnimationPlayer#destroy} has been called on this player
   * @example
   * ```ts
   * if (!player.destroyed) player.play('idle');
   * ```
   */
  public get destroyed(): boolean {
    return this._destroyed;
  }

  /**
   * Stops every animation and takes the player off the ticker for good
   *
   * Calling it again does nothing, and `play` and `gotoAndStop` on an {@link AnimationState} kept
   * from before are ignored. A {@link Model3D} destroys its own player; call this for one you built.
   * @example
   * ```ts
   * player.destroy();
   * crate.destroy();
   * ```
   */
  public destroy(): void {
    if (this._destroyed) return;

    this._destroyed = true;
    this._updating = false;
    this._disconnectTicker();
    this.stop();

    this._stateCache.forEach((state) => {
      state.onComplete = null;
      state.onLoop = null;
    });

    /* oxlint-disable pixi3d/destroy-release -- kept states, playing, stop and update still read these after destroy */
    this._states.length = 0;
    this._stateCache.clear();
    this._animations.clear();
    this._animationLabels = null;
    this._accumulators = {};
    this._accumulatorList.length = 0;
    /* oxlint-enable pixi3d/destroy-release */
  }

  private _removeStopped(): void {
    const states = this._states;
    let kept = 0;

    for (let i = 0; i < states.length; i++) {
      if (states[i].playing) states[kept++] = states[i];
    }

    states.length = kept;

    if (kept === 0) this._disconnectTicker();
  }

  private _connectTicker(): void {
    if (this._isConnectedToTicker) return;

    Ticker.shared.add(this._onTick, undefined, UPDATE_PRIORITY.HIGH);
    this._isConnectedToTicker = true;
  }

  private _disconnectTicker(): void {
    if (!this._isConnectedToTicker) return;

    Ticker.shared.remove(this._onTick);
    this._isConnectedToTicker = false;
  }

  /** Tracks with the same label share one accumulator, which is how states driving one property blend */
  private _getAccumulator(track: Track): PropertyAccumulator {
    const trackLabel = track.label;

    if (this._accumulators[trackLabel]) return this._accumulators[trackLabel];

    const split = trackLabel.split('.');
    const channel = split.pop()!;
    const nodeLabel = split.join('.');

    let target: Container3D | undefined;
    let foundSkeleton: Skeleton | undefined;
    let foundBoneIndex = -1;

    if (this._nodeMap) {
      const index = parseInt(nodeLabel, 10);
      if (!isNaN(index)) {
        const mapped = this._nodeMap[index];
        if (mapped) {
          if (mapped instanceof Container3D) {
            target = mapped;
          } else {
            foundSkeleton = mapped.skeleton;
            foundBoneIndex = mapped.boneIndex;
          }
        }
      }
    }

    if (!target && !foundSkeleton) {
      const found = findTarget(this.target, nodeLabel);
      target = found?.node;
      foundSkeleton = found?.skeleton;
      foundBoneIndex = found?.boneIndex ?? -1;
    }

    const binding = createBinding({
      target,
      channel,
      skeleton: foundSkeleton,
      boneIndex: foundBoneIndex,
    });

    const acc = new PropertyAccumulator(binding, track.valueSize);

    this._accumulators[trackLabel] = acc;
    this._accumulatorList.push(acc);

    return acc;
  }
}

/** The empty `catch` is for `Skeleton.indexOf`, which throws for a name that isn't a bone */
function findTarget(
  target: Container3D,
  label: string,
): { node?: Container3D; skeleton?: Skeleton; boneIndex?: number } | undefined {
  if (target.label === label) return { node: target };

  if (target instanceof Mesh3D && target.skeleton) {
    try {
      return { skeleton: target.skeleton, boneIndex: target.skeleton.indexOf(label) };
    } catch {}
  }

  for (const child of target.children) {
    const result = findTarget(child, label);
    if (result) return result;
  }

  return undefined;
}
