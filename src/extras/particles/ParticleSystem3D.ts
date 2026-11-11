import { Color, definedProps, Ticker, UPDATE_PRIORITY } from 'pixi.js';
import type { ColorSource, Texture } from 'pixi.js';

import { collectAttributes } from '../../core/shader/codegen/collectAttributes';
import type { ShaderBit } from '../../core/shader/ShaderBit';
import { Matrix4 } from '../../math/matrix/Matrix4';
import { seededRandom } from '../../math/utils/seededRandom';
import type { PointData3D } from '../../math/vector/PointData3D';
import { Vector3 } from '../../math/vector/Vector3';
import { ParticleContainer3D } from '../../scene/particles/ParticleContainer3D';
import type { ParticleContainer3DOptions } from '../../scene/particles/ParticleContainer3D';
import { packParticleColor } from '../../scene/particles/utils/packParticleColor';
import { expectShape } from '../../scene/particles/utils/particleLayout';
import type { ParticleValues } from '../../scene/particles/utils/particleValues';
import { updateTransformBackwards3D } from '../../scene/utils/updateTransformBackwards3D';
import type { Destroy3DOptions } from '../../utils/Destroy3DOptions';
import type { EmitterShape } from './emitterShapes/EmitterShape';
import { PointShape } from './emitterShapes/PointShape';
import { writeSpread } from './particleSpread';
import type { ParticleSpread } from './particleSpread';
import { deriveSetup } from './utils/deriveSetup';
import { generateSpawnBurst, spawnSignature } from './utils/generateSpawnBurst';
import type { ParticleSpawnOverrides, ParticleSystemValues } from './utils/spawnOverrides';
import {
  ABSENT,
  AS_F32,
  AS_FRAME,
  AS_PACKED,
  AS_TINT,
  componentsOf,
  CONSTANT,
  FROM_CLOCK,
  FROM_FRAME,
  FROM_PACKED,
  FROM_SPREAD,
  FROM_VELOCITY,
  FROM_ZERO,
  kindOf,
  PAIR,
  storeFor,
  ZERO3,
} from './utils/spawnPlan';
import type { SpawnAttribute, SpawnContext, SpawnFn, SpawnPlan, SpawnShape } from './utils/spawnPlan';

/** `speed` must match `SPEED_OFFSET` in `generateSpawn.ts` and `generateSpawnPolyfill.ts` */
const SPREAD = {
  life: 0,
  speed: 2,
  size: 4,
  sizeEnd: 6,
  alpha: 8,
  alphaEnd: 10,
  startRotation: 12,
  spin: 14,
} as const;

const SPREAD_FLOATS = 16;

/** Caps a step, so a tab back from the background doesn't age every live particle to death at once */
const MAX_STEP = 1 / 10;

const _pos = new Vector3();
const _dir = new Vector3();
const _origin3 = new Vector3();
const _parentWorld = new Matrix4();

/**
 * A scheduled burst of particles, listed in {@link ParticleSystem3DOptions.bursts}
 * @example
 * ```ts
 * const fireworks = new ParticleSystem3D({
 *   emitRate: 0,
 *   bursts: [{ time: 0, count: 200, repeatEvery: 1.5 }],
 * });
 * ```
 * @category extras:particles
 * @standard
 */
export interface ParticleBurst {
  /**
   * Seconds into the system's burst timeline when the burst fires
   * @example
   * ```ts
   * const finale: ParticleBurst = { time: 2, count: 300 };
   * ```
   */
  time: number;
  /**
   * How many particles it emits each time it fires
   * @example
   * ```ts
   * const pulse: ParticleBurst = { time: 0, count: 20, repeatEvery: 0.5 };
   * const fountain = new ParticleSystem3D({ emitRate: 0, bursts: [pulse] });
   *
   * pulse.count = 40;
   * ```
   */
  count: number;
  /**
   * Repeat interval in seconds. Omit for a one-shot
   * @example
   * ```ts
   * const heartbeat: ParticleBurst = { time: 0, count: 12, repeatEvery: 0.8 };
   * ```
   */
  repeatEvery?: number;
}

/**
 * How a multi-frame `texture` picks each particle's frame, set by
 * {@link ParticleSystem3DOptions.frameMode}
 *
 * - `'random'` gives each particle one frame, drawn at spawn, for its whole life.
 * - `'animate'` plays the frames from birth at {@link ParticleSystem3DOptions.frameRate}, looping.
 * - `'overLife'` plays the frames once across each particle's life, first at birth and last at death.
 * @example
 * ```ts
 * const flames = new ParticleSystem3D({ texture: flameFrames, frameMode: 'overLife' });
 * ```
 * @category extras:particles
 * @standard
 */
export type ParticleFrameMode = 'random' | 'animate' | 'overLife';

/**
 * Constructor options for {@link ParticleSystem3D}, on top of the {@link ParticleContainer3DOptions}
 *
 * An omitted field takes its value from {@link ParticleSystem3D.defaultOptions}.
 * @example
 * ```ts
 * const sparks = new ParticleSystem3D({
 *   capacity: 40, // emitRate × the longest life, 40 × 0.8, rounded up
 *   blendMode: 'add',
 *   emitRate: 40,
 *   life: [0.4, 0.8],
 *   speed: [2, 4],
 *   alphaEnd: 0,
 *   gravity: 9.8,
 * });
 * ```
 * @category extras:particles
 * @standard
 */
export interface ParticleSystem3DOptions<
  B extends readonly ShaderBit[] = readonly ShaderBit[],
> extends ParticleContainer3DOptions<B> {
  /**
   * Particles emitted per second. Set to 0 for a burst-only or fully manual system
   * @default 10
   * @example
   * ```ts
   * const drizzle = new ParticleSystem3D({ emitRate: 50 });
   * ```
   */
  emitRate?: number;
  /**
   * Bursts to fire on the system's burst timeline, which starts at 0 and advances only while the
   * system is {@link ParticleSystem3D.playing | playing}
   *
   * The list is copied at construction, so adding or removing a burst later does nothing. An edit
   * to a burst's `count` or `repeatEvery` applies the next time it fires; an edit to its `time`
   * applies on the next {@link ParticleSystem3D.gotoAndPlay | gotoAndPlay} or
   * {@link ParticleSystem3D.gotoAndStop | gotoAndStop}.
   * @example
   * ```ts
   * const explosion = new ParticleSystem3D({ emitRate: 0, bursts: [{ time: 0, count: 150 }] });
   * ```
   */
  bursts?: readonly ParticleBurst[];
  /**
   * Where particles start and which way they head
   * @default `new PointShape()`
   * @example
   * ```ts
   * const motes = new ParticleSystem3D({ shape: new SphereShape({ radius: 2 }) });
   * ```
   */
  shape?: EmitterShape;

  /**
   * Lifetime in seconds
   * @default 1
   * @example
   * ```ts
   * const embers = new ParticleSystem3D({ life: [1, 2.5] });
   * ```
   */
  life?: ParticleSpread;
  /**
   * Initial speed along the shape's direction, in units per second
   * @default 0
   * @example
   * ```ts
   * const jet = new ParticleSystem3D({ speed: [6, 8] });
   * ```
   */
  speed?: ParticleSpread;
  /**
   * Starting world-space diameter
   * @default 1
   * @example
   * ```ts
   * const dust = new ParticleSystem3D({ size: [0.05, 0.15] });
   * ```
   */
  size?: ParticleSpread;
  /**
   * Each particle's starting spin angle in radians, turning its quad in its own plane
   *
   * The `rotation` option turns the emitter instead.
   * @default 0
   * @example
   * ```ts
   * const leaves = new ParticleSystem3D({ startRotation: [0, Math.PI * 2] });
   * ```
   */
  startRotation?: ParticleSpread;
  /**
   * Rotation rate in radians per second. Omit to leave particles unspinning
   * @example
   * ```ts
   * const debris = new ParticleSystem3D({ spin: [-3, 3] });
   * ```
   */
  spin?: ParticleSpread;
  /**
   * Starting opacity
   * @default 1
   * @example
   * ```ts
   * const haze = new ParticleSystem3D({ alpha: [0.2, 0.4] });
   * ```
   */
  alpha?: ParticleSpread;
  /**
   * Starting tint, in display (sRGB) space
   *
   * A colour's own alpha is ignored; `alpha` sets opacity.
   * @default 0xffffff
   * @example
   * ```ts
   * const sparks = new ParticleSystem3D({ color: 'orange' });
   * ```
   */
  color?: ColorSource;

  /**
   * End-of-life size. Omit to hold the spawn size
   * @example
   * ```ts
   * const puffs = new ParticleSystem3D({ size: 0.2, sizeEnd: [1, 1.5] });
   * ```
   */
  sizeEnd?: ParticleSpread;
  /**
   * End-of-life opacity; set it to 0 for the standard fade-out. Omit to hold the spawn opacity
   * @example
   * ```ts
   * const smoke = new ParticleSystem3D({ alpha: 0.5, alphaEnd: 0 });
   * ```
   */
  alphaEnd?: ParticleSpread;
  /**
   * End-of-life tint. Omit to hold the spawn tint
   * @example
   * ```ts
   * const fire = new ParticleSystem3D({ color: 0xffdd55, colorEnd: 0xff2200 });
   * ```
   */
  colorEnd?: ColorSource;

  /**
   * Constant acceleration, in units per second squared; a number is shorthand for that much
   * downward pull
   *
   * It's in the system's own space, so in a `space: 'local'` system it turns and scales with the
   * node.
   * @example
   * ```ts
   * const fountain = new ParticleSystem3D({ speed: 5, gravity: 9.8 });
   * const windblown = new ParticleSystem3D({ gravity: { x: 1.5, y: -2, z: 0 } });
   * ```
   */
  gravity?: number | PointData3D;
  /**
   * How fast velocity dies away
   *
   * Velocity shrinks by a factor of e^-drag each second, so with gravity a particle settles at a
   * falling speed of gravity / drag.
   * @example
   * ```ts
   * const puff = new ParticleSystem3D({ speed: 8, drag: 3 });
   * ```
   */
  drag?: number;

  /**
   * How a multi-frame `texture` picks frames; {@link ParticleFrameMode} lists the modes
   *
   * Ignored for a single texture. `'animate'` and `'overLife'` read the sheet as a grid of cells the
   * size of the first frame, in order left to right then top to bottom from the top-left, and ignore
   * where each frame actually sits. Use `'random'` for a sheet that isn't laid out that way.
   * @default 'random'
   * @example
   * ```ts
   * const flames = new ParticleSystem3D({ texture: flameFrames, frameMode: 'animate' });
   * ```
   */
  frameMode?: ParticleFrameMode;
  /**
   * Frames per second for `frameMode: 'animate'`
   * @default 12
   * @example
   * ```ts
   * const flames = new ParticleSystem3D({ texture: flameFrames, frameMode: 'animate', frameRate: 24 });
   * ```
   */
  frameRate?: number;

  /**
   * Makes the random stream spawns draw from, so an effect can replay the same way
   *
   * It's called at construction and on every {@link ParticleSystem3D.gotoAndPlay | gotoAndPlay} and
   * {@link ParticleSystem3D.gotoAndStop | gotoAndStop}, so with a seeded generator `gotoAndPlay(0)`
   * replays the effect. A seek to a later time doesn't replay what the first run drew from there,
   * but two seeks to the same time, followed by the same calls, draw the same particles.
   *
   * Omitted, each stream gets a random seed, so no two runs match. `() => Math.random` works too,
   * but allocates on every draw.
   * @example
   * ```ts
   * const campfire = new ParticleSystem3D({ createRandom: () => seededRandom('campfire') });
   *
   * campfire.gotoAndPlay(0); // the same sparks as the first run
   * ```
   */
  createRandom?: () => () => number;
  /**
   * Whether {@link ParticleSystem3D.update | update} runs from `Ticker.shared` every frame;
   * {@link ParticleSystem3D.autoUpdate} says when to turn it off
   * @default true
   * @example
   * ```ts
   * const steam = new ParticleSystem3D({ autoUpdate: false });
   *
   * app.ticker.add((ticker: Ticker) => steam.update(ticker));
   * ```
   */
  autoUpdate?: boolean;
  /**
   * Whether the system is {@link ParticleSystem3D.playing | playing} from the start
   * @default true
   * @example
   * ```ts
   * const confetti = new ParticleSystem3D({
   *   autoPlay: false,
   *   emitRate: 0,
   *   bursts: [{ time: 0, count: 300 }],
   * });
   *
   * winBanner.on('shown', () => confetti.play());
   * ```
   */
  autoPlay?: boolean;

  /**
   * Called at the end of each step; see {@link ParticleSystem3D.onUpdate}
   * @example
   * ```ts
   * const flicker = new ParticleSystem3D({
   *   onUpdate: (_dt, system) => {
   *     system.emitRate = 30 + Math.sin(system.time * 4) * 20;
   *   },
   * });
   * ```
   */
  onUpdate?: ((dt: number, system: ParticleSystem3D<B>) => void) | null;
}

/**
 * A particle system with the movement built in: emission, lifetimes, spreads,
 * forces and over-life ramps, all from one options object
 *
 * A particle is written once, at birth, and the GPU works out where it is every frame after that.
 * So the CPU only pays for the particles born each frame, whatever the pool size. `spin`,
 * `sizeEnd`, `alphaEnd`, `colorEnd` and a multi-frame `texture` each add GPU work, so set only
 * what an effect needs.
 *
 * Rendering, capacity and blending come from {@link ParticleContainer3D}, which this extends.
 * Drop to that layer when you want to move particles yourself.
 * @typeParam B - The `extraBits` you pass; they type the custom attributes that
 *   {@link ParticleSystem3D.spawn | spawn} and {@link ParticleSystem3D.setParticle | setParticle} accept.
 * @example
 * ```ts
 * // Campfire smoke.
 * const smoke = new ParticleSystem3D({
 *   texture: puff,
 *   capacity: 100, // emitRate × the longest life, 30 × 3, rounded up
 *   emitRate: 30,
 *   shape: new ConeShape({ angle: 15, radius: 0.2 }),
 *   life: [1.5, 3],
 *   speed: [0.6, 1.2],
 *   size: [0.3, 0.6],
 *   sizeEnd: [1.2, 2],
 *   alpha: 0.35,
 *   alphaEnd: 0,
 *   spin: [-0.6, 0.6],
 *   drag: 0.7,
 * });
 * smoke.position.set(0, 0.5, 0);
 * view.root.addChild(smoke);
 * ```
 * @see {@link ParticleSystem3DOptions} For the constructor options.
 * @category extras:particles
 * @standard
 */
export class ParticleSystem3D<B extends readonly ShaderBit[] = readonly ShaderBit[]> extends ParticleContainer3D<B> {
  /**
   * Where particles start and which way they head; swap it at any time
   * @example
   * ```ts
   * thruster.shape = boosting ? new ConeShape({ angle: 8 }) : new ConeShape({ angle: 25 });
   * ```
   */
  public shape: EmitterShape;

  /**
   * Called at the end of each {@link ParticleSystem3D.update | update} with a step above 0, playing
   * or not, for effects the options don't cover
   *
   * Write particles with {@link ParticleSystem3D.setParticle | setParticle}, or through
   * {@link ParticleContainer3D.data | data} and {@link ParticleContainer3D.markDirty | markDirty};
   * the update uploads them after this returns. A particle written from scratch needs `aBirth` and
   * `aLife` too, or it won't draw.
   * @example
   * ```ts
   * system.onUpdate = (dt, self) => {
   *   self.uniforms.uWind = [Math.sin(self.time), 0, 0];
   * };
   * ```
   */
  public onUpdate: ((dt: number, system: ParticleSystem3D<B>) => void) | null = null;

  private readonly _bursts: readonly ParticleBurst[];
  private readonly _burstNext: Float64Array;
  private readonly _createRandom: () => () => number;

  private _gravity: Vector3 | null = null;
  private _drag: number | null = null;
  private readonly _frameMode: ParticleFrameMode;
  private _frameRate = 0;
  private readonly _hasShaderFlipbook: boolean;
  /** The sheet `deriveSetup` made for a shader flipbook, freed in `destroy`; `null` when the texture is the caller's */
  private readonly _gridSheet: Texture | null;

  private readonly _colorStart: number = 0;

  private readonly _spawnAttributes: SpawnAttribute[];
  private readonly _plan: SpawnPlan;
  private readonly _spawnContext: SpawnContext;
  private readonly _spawnShape: SpawnShape;
  private readonly _spawnSignature: string;
  /** Keyed by the pattern alone, so a burst skips building the longer key of `generateSpawnBurst`'s cache */
  private readonly _spawns = new Map<string, SpawnFn>();
  /** Rebuilt from the live parent chain each burst, since `worldTransform` is only current after a render */
  private readonly _spawnTransform = new Matrix4();

  private _cursor = 0;

  private _emitRate = 0;
  private _playing: boolean;
  private _accumulator = 0;
  /** The burst timeline in seconds; the public `time` is `_clock` */
  private _time = 0;
  /**
   * What births are stamped with and the shader reads; the goto methods never move it, so they
   * can't kill live particles
   */
  private _clock = 0;

  private _autoUpdate = false;

  /**
   * Defaults for every new `ParticleSystem3D`; an option passed as `undefined` keeps its default
   *
   * A `shape` set here is one object shared by every system that doesn't pass its own, so editing
   * its fields on one system edits them all.
   * @example
   * ```ts
   * ParticleSystem3D.defaultOptions.emitRate = 30;
   * ParticleSystem3D.defaultOptions.life = [1, 2];
   * ```
   */
  public static override defaultOptions: ParticleSystem3DOptions = {
    ...ParticleContainer3D.defaultOptions,
    shape: new PointShape(),
    emitRate: 10,
    autoPlay: true,
    autoUpdate: true,
    life: 1,
    speed: 0,
    size: 1,
    alpha: 1,
    startRotation: 0,
    color: 0xffffff,
    frameMode: 'random',
    frameRate: 12,
    // oxlint-disable-next-line no-restricted-properties -- seeds the default stream once per seek, never per draw
    createRandom: () => seededRandom(Math.random().toString(36)),
  };

  /**
   * Creates a particle system; add it under a `View3D`'s root to draw it
   * @param options - What to override in {@link ParticleSystem3D.defaultOptions | defaultOptions}.
   */
  constructor(options: ParticleSystem3DOptions<B> = {}) {
    const opts = { ...ParticleSystem3D.defaultOptions, ...definedProps(options) };
    const setup = deriveSetup(opts);
    const {
      emitRate,
      bursts,
      shape,
      life,
      speed,
      size,
      startRotation,
      spin,
      alpha,
      color,
      sizeEnd,
      alphaEnd,
      colorEnd,
      gravity,
      drag,
      frameMode,
      frameRate,
      createRandom,
      autoUpdate,
      autoPlay,
      onUpdate,
      extraBits,
      parent,
      ...rest
    } = opts;

    super({
      label: 'ParticleSystem3D',
      ...rest,
      texture: setup.texture,
      extraBits: [...setup.bits, ...(extraBits ?? [])] as unknown as B,
    });

    this.shape = shape!;
    this._bursts = [...(bursts ?? [])];
    this._gridSheet = setup.ownsTexture ? (setup.texture as Texture) : null;
    this._burstNext = new Float64Array(this._bursts.length);
    this._createRandom = createRandom!;
    this.onUpdate = onUpdate ?? null;

    this._emitRate = emitRate!;
    this._playing = autoPlay!;
    this._frameMode = frameMode!;
    this._frameRate = frameRate!;
    this._hasShaderFlipbook = setup.grid !== null;

    this._colorStart = packColor(color!);

    const spreads = new Float32Array(SPREAD_FLOATS);

    writeSpread(spreads, SPREAD.life, life, 1);
    writeSpread(spreads, SPREAD.speed, speed, 0);
    writeSpread(spreads, SPREAD.size, size, 1);
    writeSpread(spreads, SPREAD.sizeEnd, sizeEnd, 1);
    writeSpread(spreads, SPREAD.alpha, alpha, 1);
    writeSpread(spreads, SPREAD.alphaEnd, alphaEnd, 1);
    writeSpread(spreads, SPREAD.startRotation, startRotation, 0);
    writeSpread(spreads, SPREAD.spin, spin, 0);

    const attributes = createSpawnAttributes(this.data.offsets, { sizeEnd, alphaEnd, spin, colorEnd, extraBits });

    this._spawnAttributes = attributes;
    this._plan = {
      kind: attributes.map(() => ABSENT),
      raw: attributes.map(() => undefined),
      lo: attributes.map(() => undefined),
      hi: attributes.map(() => undefined),
      position: ABSENT,
      positionRaw: undefined,
      positionLo: ZERO3,
      positionHi: ZERO3,
      packedColor: this._colorStart,
    };

    const frameCount = this.textures.length;

    this._spawnShape = {
      floatStride: this.data.floatStride,
      world: this.space === 'world',
      randomFrames: frameCount > 1 && this._frameMode === 'random',
    };
    this._spawnSignature = spawnSignature(attributes, this._spawnShape);
    this._spawnContext = {
      // oxlint-disable-next-line no-restricted-properties -- placeholder; the _seek(0) below installs the real stream
      rng: Math.random,
      spreads,
      shape: this.shape,
      pos: _pos,
      dir: _dir,
      origin3: _origin3,
      worldTransform: this._spawnTransform,
      packedFrames: this._packedFrames,
      frameCount,
      packed: Uint32Array.from(attributes, (a) => a.packed),
      capacity: this.capacity,
      f32: this.data.f32,
      u32: this.data.u32,
      u16: this.data.u16,
    };

    this._seek(0);

    this.gravity = gravity ?? null;
    this.drag = drag ?? null;

    if (setup.grid) {
      this.uniforms.uFlipbookGrid = setup.grid;
      if (this._frameMode === 'animate') this.uniforms.uFrameRate = this._frameRate;
    }

    this.autoUpdate = autoUpdate!;

    parent?.addChild(this);
  }

  /**
   * The system clock in seconds, which particle ages are measured from
   *
   * It advances with each {@link ParticleSystem3D.update | update}, playing or not, and isn't the
   * burst timeline that {@link ParticleSystem3D.gotoAndPlay | gotoAndPlay} moves. Assign it to
   * scrub, backwards too: the particles still in the pool show as they would at that time, and
   * nothing is emitted.
   * @example
   * ```ts
   * scrubber.on('change', (seconds: number) => {
   *   explosion.time = seconds;
   * });
   * ```
   */
  get time(): number {
    return this._clock;
  }

  /**
   * Sets the clock
   * @param value - Clock time in seconds.
   */
  set time(value: number) {
    this._clock = value;
    this.uniforms.uParticleTime = value;
  }

  /**
   * Particles emitted per second
   * @example
   * ```ts
   * exhaust.emitRate = throttle * 200;
   * ```
   */
  get emitRate(): number {
    return this._emitRate;
  }

  /**
   * Sets the emission rate
   * @param value - Particles per second.
   */
  set emitRate(value: number) {
    this._emitRate = value;
  }

  /**
   * Whether the system is emitting and running its burst timeline
   *
   * Change it with {@link ParticleSystem3D.play | play} and {@link ParticleSystem3D.stop | stop}.
   * @example
   * ```ts
   * if (!fountain.playing) fountain.play();
   * ```
   */
  get playing(): boolean {
    return this._playing;
  }

  /**
   * Constant acceleration, or `null` for none; {@link ParticleSystem3DOptions.gravity} has the units
   *
   * A change reshapes every live particle's whole path, as if the new value had held since its
   * birth, so a big change makes particles jump. Assign a new value to change it; editing the returned
   * vector doesn't reach the particles.
   * @example
   * ```ts
   * snow.gravity = { x: wind, y: -1, z: 0 };
   * ```
   */
  get gravity(): Vector3 | null {
    return this._gravity;
  }

  /**
   * Sets the acceleration
   * @param value - A vector, a number for a pull straight down, or `null` for none.
   */
  set gravity(value: number | PointData3D | null) {
    if (value === null) {
      this._gravity = null;
    } else if (typeof value === 'number') {
      this._gravity = (this._gravity ?? new Vector3()).set(0, -value, 0);
    } else {
      this._gravity = (this._gravity ?? new Vector3()).set(value.x, value.y, value.z);
    }

    const g = this._gravity;

    this.uniforms.uGravity = g ? [g.x, g.y, g.z] : [0, 0, 0];
  }

  /**
   * How fast velocity dies away, or `null` for none; {@link ParticleSystem3DOptions.drag} has the
   * scale
   *
   * A change reshapes live particles' paths, as a change to {@link ParticleSystem3D.gravity | gravity}
   * does.
   * @example
   * ```ts
   * bubbles.drag = underwater ? 4 : null;
   * ```
   */
  get drag(): number | null {
    return this._drag;
  }

  /**
   * Sets the drag
   * @param value - The drag, or `null` for none.
   */
  set drag(value: number | null) {
    this._drag = value;
    this.uniforms.uDrag = value ?? 0;
  }

  /**
   * Frames per second for `frameMode: 'animate'`
   * @example
   * ```ts
   * flames.frameRate = 24;
   * ```
   */
  get frameRate(): number {
    return this._frameRate;
  }

  /**
   * Sets the flipbook rate
   * @param value - Frames per second.
   */
  set frameRate(value: number) {
    this._frameRate = value;
    if (this._hasShaderFlipbook && this._frameMode === 'animate') this.uniforms.uFrameRate = value;
  }

  /**
   * Whether {@link ParticleSystem3D.update | update} runs from `Ticker.shared` every frame
   *
   * It runs after `Ticker.shared` callbacks at the default priority, so particles spawn where those
   * left the emitter. An `Application` renders from its own ticker unless built with
   * `sharedTicker: true`, so new particles can show a frame late. Turn this off and call `update`
   * from `app.ticker` to avoid that, or to step the system from a loop of your own.
   * @example
   * ```ts
   * steam.autoUpdate = false;
   * app.ticker.add((ticker: Ticker) => steam.update(ticker));
   * ```
   */
  get autoUpdate(): boolean {
    return this._autoUpdate;
  }

  /**
   * Turns automatic updates on or off
   * @param value - Whether to run `update()` every frame.
   */
  set autoUpdate(value: boolean) {
    if (value === this._autoUpdate) return;

    this._autoUpdate = value;

    if (value) {
      Ticker.shared.add(this._onTick, undefined, UPDATE_PRIORITY.LOW + 1);
    } else {
      Ticker.shared.remove(this._onTick);
    }
  }

  /**
   * Resumes emitting, and the burst timeline, from where {@link ParticleSystem3D.stop | stop} left them
   * @example
   * ```ts
   * exhaust.play();
   * ```
   */
  public play(): void {
    this._playing = true;
  }

  /**
   * Stops emitting and freezes the burst timeline where it is
   *
   * Live particles carry on until their lifetimes run out. {@link ParticleSystem3D.clear | clear}
   * removes them at once, and turning off {@link ParticleSystem3D.autoUpdate | autoUpdate} freezes
   * them in place.
   * @example
   * ```ts
   * exhaust.stop();
   * ```
   */
  public stop(): void {
    this._playing = false;
  }

  /**
   * Moves the burst timeline to `time` and plays from there
   *
   * Bursts due before `time` count as spent, and a repeating one picks up at its next repeat.
   * `gotoAndPlay(0)` restarts the effect, drawing from a fresh
   * {@link ParticleSystem3DOptions.createRandom | random stream}. Live particles, and the
   * {@link ParticleSystem3D.time | clock} they're drawn at, don't change.
   * @example
   * ```ts
   * explosion.gotoAndPlay(0);
   * ```
   * @param time - Seconds into the burst timeline.
   * @throws {RangeError} If `time` is not a finite number
   */
  public gotoAndPlay(time: number): void {
    this._seek(time);
    this.play();
  }

  /**
   * Moves the burst timeline to `time` and stops there; {@link ParticleSystem3D.gotoAndPlay | gotoAndPlay}
   * says what the move changes
   * @example
   * ```ts
   * fireworks.gotoAndStop(0);
   * launchButton.on('pointertap', () => fireworks.play());
   * ```
   * @param time - Seconds into the burst timeline.
   * @throws {RangeError} If `time` is not a finite number
   */
  public gotoAndStop(time: number): void {
    this._seek(time);
    this.stop();
  }

  /**
   * Emits `count` particles right now, whether or not the system is
   * {@link ParticleSystem3D.playing | playing}
   *
   * Slots are reused in spawn order, so once all are used a new particle replaces the oldest, even
   * if it's still alive. A `count` over the capacity spawns the capacity. The new particles upload
   * with the next {@link ParticleSystem3D.update | update} that has a step above 0.
   * @example
   * ```ts
   * sparks.spawn(30, { position: hit.point, color: 0xffaa00 });
   * ```
   * @param count - How many to emit.
   * @param overrides - Values for this batch in place of the system's options.
   */
  public spawn(count: number, overrides?: ParticleSpawnOverrides<B>): void {
    const plan = this._plan;
    const o = overrides as Record<string, unknown> | undefined;

    if (o !== undefined) this._checkOverrides(o);

    const attributes = this._spawnAttributes;
    const packed = this._spawnContext.packed;
    let packedOverride = -1;

    for (let i = 0; i < attributes.length; i++) {
      const key = attributes[i].key;
      let raw = key === '' ? undefined : o?.[key];

      if (raw !== undefined && attributes[i].source === FROM_PACKED) {
        packed[i] = packColor(raw as ColorSource);
        packedOverride = i;
        raw = undefined;
      }

      const kind = kindOf(raw);

      plan.raw[i] = raw;
      plan.kind[i] = kind;
      plan.lo[i] = kind === PAIR ? (raw as readonly [unknown, unknown])[0] : undefined;
      plan.hi[i] = kind === PAIR ? (raw as readonly [unknown, unknown])[1] : undefined;
    }

    plan.positionRaw = o?.position;
    plan.position = kindOf(plan.positionRaw);
    if (plan.position === PAIR) {
      const pair = plan.positionRaw as readonly [PointData3D, PointData3D];

      plan.positionLo = pair[0];
      plan.positionHi = pair[1];
    }
    plan.packedColor = o?.color === undefined ? this._colorStart : packColor(o.color as ColorSource);

    this._spawnBatch(Math.min(count, this.capacity));

    if (packedOverride >= 0) packed[packedOverride] = attributes[packedOverride].packed;
  }

  /**
   * Writes any of a particle's attributes by name, the system's own {@link ParticleSystemValues}
   * included; see {@link ParticleContainer3D.setParticle}
   * @example
   * ```ts
   * sparks.setParticle(0, { aPosition: { x: 0, y: 2, z: 0 }, aBirth: sparks.time, aLife: 1.5 });
   * ```
   * @param index - Slot to write, 0 to `capacity - 1`.
   * @param values - Attribute name to value. An undeclared name throws.
   * @advanced
   */
  public override setParticle(index: number, values: ParticleValues<B> & ParticleSystemValues): void {
    super.setParticle(index, values);
  }

  /**
   * Moves the clock on by one step, emits what's due and uploads what was born
   *
   * Runs every frame while {@link ParticleSystem3D.autoUpdate | autoUpdate} is on; call it yourself
   * otherwise. A fixed-step loop keeps a `Ticker` of its own and sets its `deltaMS` before each call.
   * @example
   * ```ts
   * const step = new Ticker();
   *
   * step.deltaMS = 1000 / 120;
   * system.update(step); // one 120 Hz step, however long the frame took
   * ```
   * @param ticker - Supplies the step as its `deltaMS`, capped at a tenth of a second. Omitted, the
   *   step is one 60 fps frame.
   */
  public update(ticker?: Ticker): void {
    const dt = ticker ? Math.min(ticker.deltaMS / 1000, MAX_STEP) : 1 / 60;

    if (!(dt > 0)) return;

    this._clock += dt;
    this.uniforms.uParticleTime = this._clock;

    if (this._playing) {
      this._time += dt;
      this._emitBursts();

      this._accumulator += this._emitRate * dt;

      let due = this._accumulator | 0;

      if (due > 0) {
        this._accumulator -= due;
        if (due > this.capacity) due = this.capacity;
        this._resetPlan();
        this._spawnBatch(due);
      }
    }

    this.onUpdate?.(dt, this);
    this.upload();
  }

  /**
   * Kills every particle, from the next {@link ParticleSystem3D.update | update} on
   *
   * Emission and the burst timeline carry on; {@link ParticleSystem3D.gotoAndPlay | gotoAndPlay(0)}
   * restarts the timeline too.
   * @example
   * ```ts
   * respawnButton.on('pointertap', () => {
   *   smoke.clear();
   *   smoke.gotoAndPlay(0);
   * });
   * ```
   */
  public override clear(): void {
    this._cursor = 0;
    this._accumulator = 0;
    super.clear();
  }

  private readonly _onTick = (ticker: Ticker): void => {
    this.update(ticker);
  };

  /**
   * Stops updating and destroys the system; `options` works as for
   * {@link ParticleContainer3D.destroy}
   * @example
   * ```ts
   * explosion.destroy();
   * ```
   * @param options - Teardown flags; see {@link Destroy3DOptions}.
   */
  public override destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;
    this.autoUpdate = false;
    this.onUpdate = null;
    (this._createRandom as (() => () => number) | null) = null;
    super.destroy(options);
    this._gridSheet?.destroy(false);
  }

  private _seek(time: number): void {
    if (!Number.isFinite(time)) {
      throw new RangeError(`[ParticleSystem3D] time must be a finite number of seconds, got ${time}`);
    }

    this._time = time;
    this._accumulator = 0;
    this._spawnContext.rng = this._createRandom();

    for (let i = 0; i < this._bursts.length; i++) {
      const { time: start, repeatEvery } = this._bursts[i];
      let next = start;

      if (time > start) {
        next =
          repeatEvery !== undefined && repeatEvery > 0
            ? start + Math.ceil((time - start) / repeatEvery) * repeatEvery
            : Infinity;
      }

      this._burstNext[i] = next;
    }
  }

  /** Fires a repeating burst's missed repeats at most a pool's worth of times; more would only overwrite each other */
  private _emitBursts(): void {
    const bursts = this._bursts;

    for (let b = 0; b < bursts.length; b++) {
      const burst = bursts[b];
      let next = this._burstNext[b];

      const repeatEvery = burst.repeatEvery !== undefined && burst.repeatEvery > 0 ? burst.repeatEvery : 0;
      const maxFires = Math.ceil(this.capacity / Math.max(1, burst.count));
      let fired = 0;

      while (this._time >= next) {
        this.spawn(burst.count);

        if (repeatEvery === 0) {
          next = Infinity;
          break;
        }

        next += repeatEvery;

        if (++fired >= maxFires && this._time >= next) {
          next += (Math.floor((this._time - next) / repeatEvery) + 1) * repeatEvery;
        }
      }

      this._burstNext[b] = next;
    }
  }

  private _resetPlan(): void {
    const plan = this._plan;

    plan.kind.fill(ABSENT);
    plan.raw.fill(undefined);
    plan.lo.fill(undefined);
    plan.hi.fill(undefined);
    plan.position = ABSENT;
    plan.positionRaw = undefined;
    plan.packedColor = this._colorStart;
  }

  /**
   * Writes `count` particles from the current plan
   * @param count - At most the capacity, since the dirty range below wraps the pool only once
   */
  private _spawnBatch(count: number): void {
    const plan = this._plan;
    const key = plan.kind.join('') + plan.position;
    let spawn = this._spawns.get(key);

    if (spawn === undefined) {
      spawn = generateSpawnBurst(
        this._spawnSignature,
        this._spawnAttributes,
        plan.kind,
        plan.position,
        this._spawnShape,
      );
      this._spawns.set(key, spawn);
    }

    const ctx = this._spawnContext;

    ctx.shape = this.shape;
    if (this._spawnShape.world) this._refreshSpawnTransform();

    const first = this._cursor;
    const capacity = this.capacity;
    const last = first + count - 1;

    this._cursor = spawn(ctx, plan, this._clock, first, count);

    if (last < capacity) {
      this.markDirty(first, last);
    } else {
      this.markDirty(first, capacity - 1);
      this.markDirty(0, last - capacity);
    }
  }

  private _checkOverrides(o: Record<string, unknown>): void {
    const attributes = this._spawnAttributes;

    for (const key in o) {
      const raw = o[key];

      if (key === 'color' || raw === undefined) continue;

      let components = key === 'position' ? 3 : 0;

      if (components === 0) {
        for (let i = 0; i < attributes.length; i++) {
          if (attributes[i].key === key) {
            components = attributes[i].components;
            break;
          }
        }

        if (components === 0) throw new Error(`[ParticleSystem3D] spawn(): nothing takes '${key}'.`);
        if (key === 'colorEnd') continue;
      }

      const kind = kindOf(raw);

      if (kind === CONSTANT) {
        expectShape(key, raw, components);
      } else if (kind === PAIR) {
        const pair = raw as readonly [unknown, unknown];

        expectShape(key, pair[0], components);
        expectShape(key, pair[1], components);
      }
    }
  }

  private _refreshSpawnTransform(): void {
    updateTransformBackwards3D(this, _parentWorld.identity());

    if (this._localTransformDirty) {
      this.updateLocalTransform();
      this._localTransformDirty = false;
    }

    _parentWorld.multiply(this.localTransform, this._spawnTransform);
  }
}

function packColor(value: ColorSource): number {
  return packParticleColor(typeof value === 'number' ? value : Color.shared.setValue(value).toNumber(), 1);
}

/**
 * The list is in draw order, so reordering it changes what every seed produces. A user bit that
 * redeclares a built-in gets no entry, or it would write zero over the built-in.
 */
function createSpawnAttributes(
  offsets: Readonly<Record<string, number>>,
  options: Pick<ParticleSystem3DOptions, 'sizeEnd' | 'alphaEnd' | 'spin' | 'colorEnd' | 'extraBits'>,
): SpawnAttribute[] {
  const { sizeEnd, alphaEnd, spin, colorEnd, extraBits } = options;
  const at = (name: string): number => offsets[name] / 4;
  const owned = new Set<string>(['aPosition', 'aUV']);
  const entry = (
    key: string,
    name: string,
    offset: number,
    components: number,
    source: number,
    spread: number,
    store: number,
    packed = 0,
  ): SpawnAttribute => {
    owned.add(name);

    return { key, index: at(name), offset, components, source, spread, packed, store };
  };

  const attributes: SpawnAttribute[] = [
    entry('velocity', 'aVel', 0, 3, FROM_VELOCITY, 0, AS_F32),
    entry('life', 'aLife', 0, 1, FROM_SPREAD, SPREAD.life, AS_F32),
    entry('size', 'aParticleSizeRot', 0, 1, FROM_SPREAD, SPREAD.size, AS_F32),
    entry('alpha', 'aParticleColor', 0, 1, FROM_SPREAD, SPREAD.alpha, AS_TINT),
    entry('startRotation', 'aParticleSizeRot', 1, 1, FROM_SPREAD, SPREAD.startRotation, AS_F32),
  ];

  if (offsets.aParticleUVFrame !== undefined)
    attributes.push(entry('', 'aParticleUVFrame', 0, 4, FROM_FRAME, 0, AS_FRAME));
  attributes.push(entry('', 'aBirth', 0, 1, FROM_CLOCK, 0, AS_F32));
  if (sizeEnd !== undefined) attributes.push(entry('sizeEnd', 'aSizeEnd', 0, 1, FROM_SPREAD, SPREAD.sizeEnd, AS_F32));
  if (alphaEnd !== undefined)
    attributes.push(entry('alphaEnd', 'aAlphaEnd', 0, 1, FROM_SPREAD, SPREAD.alphaEnd, AS_F32));
  if (spin !== undefined) attributes.push(entry('spin', 'aSpin', 0, 1, FROM_SPREAD, SPREAD.spin, AS_F32));
  if (colorEnd !== undefined)
    attributes.push(entry('colorEnd', 'aColorEnd', 0, 4, FROM_PACKED, 0, AS_PACKED, packColor(colorEnd)));

  for (const [name, format] of Object.entries(collectAttributes([...(extraBits ?? [])]))) {
    if (owned.has(name) || offsets[name] === undefined) continue;

    const store = storeFor(format);

    if (store < 0) {
      throw new Error(`[ParticleSystem3D] cannot spawn into '${name}': no packer for the format '${format}'.`);
    }

    attributes.push(entry(name, name, 0, componentsOf(format), FROM_ZERO, 0, store));
  }

  return attributes;
}
