import { Ticker } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Container3D } from '~/scene/Container3D';

import { Animation } from '../Animation';
import { AnimationPlayer } from '../AnimationPlayer';
import { QuaternionTrack } from '../tracks/QuaternionTrack';
import { Track } from '../tracks/Track';
import { Vector3Track } from '../tracks/Vector3Track';

interface TestPlayer {
  player: AnimationPlayer;
  target: Container3D;
}

interface TickerConnection {
  fn: (ticker: Ticker) => void;
  context: unknown;
}

function createPlayer(options: { autoUpdate?: boolean } = {}): TestPlayer {
  const target = new Container3D();

  target.label = 'Root';

  const clip = new Animation({
    label: 'move',
    tracks: [
      new Vector3Track({
        label: 'Root.position',
        times: [0, 1],
        values: [0, 0, 0, 10, 0, 0],
      }),
    ],
  });

  const player = new AnimationPlayer({
    target,
    animations: { move: clip },
    ...options,
  });

  return { player, target };
}

function mockSharedTicker() {
  const connections: TickerConnection[] = [];

  const addSpy = vi.spyOn(Ticker.shared, 'add').mockImplementation((fn, context) => {
    connections.push({
      fn: fn as TickerConnection['fn'],
      context,
    });

    return Ticker.shared;
  });

  const removeSpy = vi.spyOn(Ticker.shared, 'remove').mockImplementation((fn, context) => {
    const index = connections.findIndex((connection) => connection.fn === fn && connection.context === context);

    if (index !== -1) {
      connections.splice(index, 1);
    }

    return Ticker.shared;
  });

  return { connections, addSpy, removeSpy };
}

function tick(deltaMS: number): Ticker {
  return { deltaMS } as Ticker;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AnimationPlayer autoUpdate', () => {
  it('defaults to shared ticker updates when playback starts', () => {
    const { addSpy, connections, removeSpy } = mockSharedTicker();
    const { player } = createPlayer();

    expect(player.autoUpdate).toBe(true);

    const action = player.play('move');

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(connections).toHaveLength(1);

    action.play();

    expect(addSpy).toHaveBeenCalledTimes(1);

    action.stop();

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(connections).toHaveLength(0);
  });

  it('does not connect to the shared ticker when autoUpdate is disabled', () => {
    const { addSpy } = mockSharedTicker();
    const { player, target } = createPlayer({ autoUpdate: false });

    expect(player.autoUpdate).toBe(false);

    player.play('move');

    expect(addSpy).not.toHaveBeenCalled();

    player.update(tick(500));

    expect(target.position.x).toBeCloseTo(5);
  });

  it('uses ticker deltaMS as seconds for automatic updates', () => {
    const { connections } = mockSharedTicker();
    const { player, target } = createPlayer();

    const action = player.play('move');

    action.loop = false;
    connections[0].fn(tick(250));

    expect(target.position.x).toBeCloseTo(2.5);
  });

  it('advances one 60 fps frame when update() gets no ticker', () => {
    const { player } = createPlayer({ autoUpdate: false });
    const state = player.play('move');

    player.update();

    expect(state.time).toBeCloseTo(1 / 60);
  });

  it('adds and removes the ticker listener when toggled while playing', () => {
    const { addSpy, connections, removeSpy } = mockSharedTicker();
    const { player } = createPlayer({ autoUpdate: false });

    player.play('move');
    player.autoUpdate = true;

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(connections).toHaveLength(1);

    player.autoUpdate = false;

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(connections).toHaveLength(0);
  });

  it('keeps the ticker connected until the final active action stops', () => {
    const { addSpy, connections, removeSpy } = mockSharedTicker();
    const { player } = createPlayer();

    player.addAnimations({
      idle: new Animation({ label: 'idle', duration: 1 }),
    });

    const move = player.play('move');
    const idle = player.play('idle');

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(connections).toHaveLength(1);

    move.stop();

    expect(removeSpy).not.toHaveBeenCalled();
    expect(connections).toHaveLength(1);

    idle.stop();

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(connections).toHaveLength(0);
  });

  it('disconnects from the shared ticker when destroyed', () => {
    const { connections, removeSpy } = mockSharedTicker();
    const { player } = createPlayer();

    player.play('move');
    player.destroy();

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(connections).toHaveLength(0);
  });
});

describe('AnimationState playback', () => {
  it('stop() freezes at the current time, and play() resumes from it', () => {
    const { connections } = mockSharedTicker();
    const { player, target } = createPlayer();
    const state = player.play('move');

    player.update(tick(250));
    state.stop();

    expect(state.playing).toBe(false);
    expect(state.time).toBeCloseTo(0.25);
    expect(target.position.x).toBeCloseTo(2.5);
    expect(connections).toHaveLength(0);

    player.update(tick(250));

    expect(state.time).toBeCloseTo(0.25);

    state.play();
    player.update(tick(250));

    expect(state.playing).toBe(true);
    expect(target.position.x).toBeCloseTo(5);
  });

  it('gotoAndStop() applies the pose at that time without playing', () => {
    const { connections } = mockSharedTicker();
    const { player, target } = createPlayer();
    const state = player.getState('move');

    state.gotoAndStop(0.75);

    expect(state.playing).toBe(false);
    expect(state.time).toBe(0.75);
    expect(target.position.x).toBeCloseTo(7.5);
    expect(connections).toHaveLength(0);
  });

  it('gotoAndPlay() plays on from that time', () => {
    const { connections } = mockSharedTicker();
    const { player, target } = createPlayer();
    const state = player.getState('move');

    state.gotoAndPlay(0.5);
    player.update(tick(250));

    expect(state.playing).toBe(true);
    expect(connections).toHaveLength(1);
    expect(target.position.x).toBeCloseTo(7.5);
  });

  it('scales time by animationSpeed, and plays backwards when it is negative', () => {
    mockSharedTicker();
    const { player, target } = createPlayer({ autoUpdate: false });
    const state = player.play('move');

    state.animationSpeed = 2;
    player.update(tick(250));

    expect(target.position.x).toBeCloseTo(5);

    state.animationSpeed = -1;
    player.update(tick(250));

    expect(target.position.x).toBeCloseTo(2.5);
  });

  it('player stop() freezes every playing state', () => {
    const { connections } = mockSharedTicker();
    const { player } = createPlayer();

    player.addAnimations([new Animation({ label: 'idle', duration: 1 })]);

    const move = player.play('move');
    const idle = player.play('idle');

    expect(player.playing).toBe(true);

    player.update(tick(250));
    player.stop();

    expect(player.playing).toBe(false);
    expect(move.playing).toBe(false);
    expect(idle.playing).toBe(false);
    expect(move.time).toBeCloseTo(0.25);
    expect(connections).toHaveLength(0);
  });
});

describe('AnimationState callbacks', () => {
  it('a one-shot animation holds its end pose, calls onComplete once, and releases the ticker', () => {
    const { connections, removeSpy } = mockSharedTicker();
    const { player, target } = createPlayer();
    const state = player.getState('move');
    const poseAtComplete: number[] = [];
    const onComplete = vi.fn<() => void>(() => poseAtComplete.push(target.position.x));

    state.loop = false;
    state.onComplete = onComplete;
    state.play();

    connections[0].fn(tick(600));

    expect(onComplete).not.toHaveBeenCalled();

    connections[0].fn(tick(600));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(poseAtComplete).toEqual([10]);
    expect(state.playing).toBe(false);
    expect(state.time).toBe(1);
    expect(player.playing).toBe(false);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(connections).toHaveLength(0);

    player.update(tick(600));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(target.position.x).toBeCloseTo(10);
  });

  it('completes at the start when a one-shot animation plays backwards', () => {
    mockSharedTicker();
    const { player, target } = createPlayer({ autoUpdate: false });
    const state = player.getState('move');
    const onComplete = vi.fn<() => void>();

    state.loop = false;
    state.animationSpeed = -1;
    state.onComplete = onComplete;
    state.gotoAndPlay(0.5);
    player.update(tick(600));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(state.time).toBe(0);
    expect(target.position.x).toBeCloseTo(0);
  });

  it('calls onLoop when a looping animation wraps, and keeps playing', () => {
    mockSharedTicker();
    const { player } = createPlayer({ autoUpdate: false });
    const state = player.play('move');
    const onLoop = vi.fn<() => void>();

    state.onLoop = onLoop;
    player.update(tick(600));

    expect(onLoop).not.toHaveBeenCalled();

    player.update(tick(600));

    expect(onLoop).toHaveBeenCalledTimes(1);
    expect(state.time).toBeCloseTo(0.2);
    expect(state.playing).toBe(true);
  });

  it('lets onComplete start the next animation without dropping the ticker', () => {
    const { connections } = mockSharedTicker();
    const { player } = createPlayer();

    player.addAnimations([new Animation({ label: 'idle', duration: 1 })]);

    const move = player.getState('move');
    const idle = player.getState('idle');

    move.loop = false;
    move.onComplete = () => idle.play();
    move.play();
    connections[0].fn(tick(1500));

    expect(move.playing).toBe(false);
    expect(idle.playing).toBe(true);
    expect(idle.time).toBe(0);
    expect(connections).toHaveLength(1);
  });

  it('clears callbacks when the player is destroyed', () => {
    mockSharedTicker();
    const { player } = createPlayer();
    const state = player.getState('move');

    state.onComplete = () => {};
    state.onLoop = () => {};
    player.destroy();

    expect(state.onComplete).toBeNull();
    expect(state.onLoop).toBeNull();
  });

  it('lets onComplete destroy the player while another animation is still playing', () => {
    const { connections } = mockSharedTicker();
    const { player } = createPlayer();

    player.addAnimations([new Animation({ label: 'idle', duration: 1 })]);

    const move = player.getState('move');
    const idle = player.getState('idle');

    move.loop = false;
    move.onComplete = () => player.destroy();
    move.play();
    idle.play();

    expect(() => connections[0].fn(tick(1500))).not.toThrow();

    expect(player.destroyed).toBe(true);
    expect(move.playing).toBe(false);
    expect(idle.playing).toBe(false);
    expect(player.playing).toBe(false);
    expect(connections).toHaveLength(0);
  });

  it('lets onComplete stop the player while another animation is still playing', () => {
    const { connections } = mockSharedTicker();
    const { player } = createPlayer();

    player.addAnimations([new Animation({ label: 'idle', duration: 1 })]);

    const move = player.getState('move');
    const idle = player.getState('idle');

    move.loop = false;
    move.onComplete = () => player.stop();
    move.play();
    idle.play();

    expect(() => connections[0].fn(tick(1500))).not.toThrow();

    expect(move.playing).toBe(false);
    expect(idle.playing).toBe(false);
    expect(player.playing).toBe(false);
    expect(connections).toHaveLength(0);
  });
});

describe('AnimationPlayer autoPlay', () => {
  it('does not play anything by default', () => {
    const { connections } = mockSharedTicker();
    const { player } = createPlayer();

    expect(player.playing).toBe(false);
    expect(connections).toHaveLength(0);
  });

  it('plays the first animation when true, or the named one when a label', () => {
    mockSharedTicker();
    const target = new Container3D();
    const first = new Animation({ label: 'first', duration: 1 });
    const second = new Animation({ label: 'second', duration: 1 });

    const byFlag = new AnimationPlayer({ target, animations: [first, second], autoPlay: true });
    const byLabel = new AnimationPlayer({ target, animations: [first, second], autoPlay: 'second' });

    expect(byFlag.getState('first').playing).toBe(true);
    expect(byFlag.getState('second').playing).toBe(false);
    expect(byLabel.getState('first').playing).toBe(false);
    expect(byLabel.getState('second').playing).toBe(true);

    byFlag.destroy();
    byLabel.destroy();
  });

  it('plays an animation registered under the empty label', () => {
    mockSharedTicker();
    const target = new Container3D();
    const unnamed = new Animation({ label: '', duration: 1 });
    const player = new AnimationPlayer({ target, animations: { '': unnamed }, autoPlay: '' });

    expect(player.getState('').playing).toBe(true);

    player.destroy();
  });

  it('ignores autoPlay: true when there is nothing to play', () => {
    const player = new AnimationPlayer({ target: new Container3D(), autoPlay: true });

    expect(player.playing).toBe(false);
  });

  it('treats an explicit undefined as the default', () => {
    const player = new AnimationPlayer({ target: new Container3D(), autoUpdate: undefined });

    expect(player.autoUpdate).toBe(true);
  });
});

describe('AnimationPlayer registry', () => {
  it('looks animations up by label and lists labels in registration order', () => {
    const { player } = createPlayer({ autoUpdate: false });
    const idle = new Animation({ label: 'idle', duration: 1 });

    player.addAnimations([idle]);

    expect(player.animationLabels).toEqual(['move', 'idle']);
    expect(player.getAnimation('idle')).toBe(idle);
    expect(player.getAnimation('missing')).toBeUndefined();
  });

  it('returns one cached state per animation, by label or by instance', () => {
    const { player } = createPlayer({ autoUpdate: false });
    const move = player.getAnimation('move')!;
    const state = player.getState('move');

    expect(state.animation).toBe(move);
    expect(player.getState(move)).toBe(state);
    expect(player.play('move')).toBe(state);
  });

  it('throws for an unregistered label', () => {
    const { player } = createPlayer({ autoUpdate: false });

    expect(() => player.getState('missing')).toThrow('[AnimationPlayer] Animation "missing" is not registered.');
  });

  it('types the fields fixed at construction as read-only', () => {
    const { player, target } = createPlayer({ autoUpdate: false });
    const state = player.getState('move');

    // Never called: tsc checks these assignments are rejected.
    const reassign = (): void => {
      // @ts-expect-error bindings resolve against the original target
      player.target = target;
      // @ts-expect-error the state's track cursors are sized from this animation
      state.animation = player.getAnimation('move')!;
      // @ts-expect-error a state belongs to the player that created it
      state.player = player;
      // @ts-expect-error duration is computed from the tracks once
      state.animation.tracks.push(state.animation.tracks[0]);
    };

    expect(reassign).toBeTypeOf('function');
  });
});

describe('AnimationPlayer wide tracks', () => {
  it('samples every component of a track wider than the built-in value types', () => {
    // Morph-weight tracks carry one float per target — MorphStressTest has 8.
    // The shared evaluation scratch was sized for a quaternion (4), so
    // components 4+ read back undefined and poisoned the weights with NaN.
    mockSharedTicker();

    const target = new Container3D();
    target.label = 'Root';
    (target as Container3D & { weights?: Float32Array }).weights = new Float32Array(8);

    const clip = new Animation({
      label: 'morph',
      tracks: [
        new Track({
          label: 'Root.weights',
          times: [0, 1],
          values: [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8],
          valueSize: 8,
        }),
      ],
    });

    const player = new AnimationPlayer({
      target,
      animations: { morph: clip },
      autoUpdate: false,
    });

    const state = player.play('morph');
    state.time = 0.5;
    player.update(tick(0));

    const weights = (target as Container3D & { weights: Float32Array }).weights;
    expect(Array.from(weights)).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);

    player.destroy();
  });
});

describe('AnimationPlayer blending', () => {
  it('blends two states writing the same property into a weighted average', () => {
    // A crossfade: two clips drive Root.weights at once. The first state to run
    // samples straight into the accumulator; the second samples into scratch and
    // blends in — the result is the weight-weighted average of both samples,
    // independent of which state ran first.
    mockSharedTicker();

    const target = new Container3D();
    target.label = 'Root';
    (target as Container3D & { weights?: Float32Array }).weights = new Float32Array(2);

    const clipA = new Animation({
      label: 'a',
      tracks: [new Track({ label: 'Root.weights', times: [0, 1], values: [0, 0, 10, 20], valueSize: 2 })],
    });
    const clipB = new Animation({
      label: 'b',
      tracks: [new Track({ label: 'Root.weights', times: [0, 1], values: [0, 0, 30, 40], valueSize: 2 })],
    });

    const player = new AnimationPlayer({
      target,
      animations: { a: clipA, b: clipB },
      autoUpdate: false,
    });

    // At t=0.5: A samples [5, 10] (weight 1), B samples [15, 20] (weight 3).
    // Weighted average = (1·[5, 10] + 3·[15, 20]) / 4 = [12.5, 17.5].
    const a = player.play('a');
    a.time = 0.5;
    a.weight = 1;
    const b = player.play('b');
    b.time = 0.5;
    b.weight = 3;
    player.update(tick(0));

    const weights = (target as Container3D & { weights: Float32Array }).weights;
    expect(Array.from(weights)).toEqual([12.5, 17.5]);

    player.destroy();
  });
});

describe('AnimationPlayer destroy', () => {
  it('marks the player as destroyed', () => {
    mockSharedTicker();
    const { player } = createPlayer();

    expect(player.destroyed).toBe(false);

    player.destroy();

    expect(player.destroyed).toBe(true);
  });

  it('is idempotent and does not double-disconnect from the ticker', () => {
    const { removeSpy } = mockSharedTicker();
    const { player } = createPlayer();

    player.play('move');

    player.destroy();
    player.destroy();

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(player.destroyed).toBe(true);
  });

  it('ignores playback on a state kept after destroy', () => {
    const { addSpy, connections } = mockSharedTicker();
    const { player, target } = createPlayer();
    const state = player.play('move');

    player.update(tick(250));
    player.destroy();

    state.play();
    state.gotoAndPlay(0.5);
    state.gotoAndStop(1);

    expect(state.playing).toBe(false);
    expect(player.playing).toBe(false);
    // Only the pre-destroy play reached the ticker, and the held pose was not rewritten.
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(connections).toHaveLength(0);
    expect(target.position.x).toBeCloseTo(2.5);
  });
});

describe('AnimationPlayer quaternion blending', () => {
  it('blends opposite-hemisphere encodings of the same rotation without cancelling', () => {
    const target = new Container3D();

    target.label = 'Root';

    const s = Math.SQRT1_2; // 90° about Z
    const clipA = new Animation({
      label: 'a',
      tracks: [new QuaternionTrack({ label: 'Root.quaternion', times: [0, 1], values: [0, 0, s, s, 0, 0, s, s] })],
    });
    // The same rotation, encoded with every component negated.
    const clipB = new Animation({
      label: 'b',
      tracks: [new QuaternionTrack({ label: 'Root.quaternion', times: [0, 1], values: [0, 0, -s, -s, 0, 0, -s, -s] })],
    });

    const player = new AnimationPlayer({
      target,
      animations: { a: clipA, b: clipB },
      autoUpdate: false,
    });

    const stateA = player.play('a');
    const stateB = player.play('b');

    stateA.weight = 0.5;
    stateB.weight = 0.5;
    player.update(tick(250));

    const q = target.quaternion;

    expect(q.z).toBeCloseTo(s);
    expect(q.w).toBeCloseTo(s);
    expect(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w).toBeCloseTo(1);
  });
});
