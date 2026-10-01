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

/**
 * Offsets of each spawn spread's `[min, max]` pair
 *
 * No attribute carries the speed offset, so `generateSpawn` and `generateSpawnPolyfill` hard-code
 * it as `SPEED_OFFSET`. Move `speed` and those must follow.
 */
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

/**
 * Longest step, in seconds, that {@link ParticleSystem3D.update | update} takes from one tick
 *
 * A backgrounded tab hands back a huge `deltaMS`. Without a ceiling the clock would jump that far,
 * and every live particle would skip to the end of its life on the first frame back.
 */
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
   * How many particles it emits
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
 * Constructor options for {@link ParticleSystem3D}
 *
 * Every field is optional, and the container options ({@link ParticleContainer3DOptions}) are
 * accepted too. An omitted field takes its value from {@link ParticleSystem3D.defaultOptions}.
 * @example
 * ```ts
 * const sparks = new ParticleSystem3D({
 *   capacity: 300,
 *   blendMode: 'add',
 *   emitRate: 40,
 *   life: [0.4, 0.8],
 *   speed: [2, 4],
 *   alphaEnd: 0,
 *   gravity: 9.8,
 * });
 * ```
 * @see {@link ParticleSystem3D} For the constructed system.
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
   * Scheduled bursts, timed on the system's burst timeline
   *
   * The timeline starts at 0 and advances only while the system is
   * {@link ParticleSystem3D.playing | playing};
   * {@link ParticleSystem3D.gotoAndPlay | gotoAndPlay} moves it. The list is
   * copied at construction, so add or remove bursts before then. A burst's own
   * fields stay yours to edit: `count` and `repeatEvery` apply as it fires,
   * `time` on the next `gotoAndPlay` or `gotoAndStop`.
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
   * Each particle's starting spin angle about the view axis, in radians
   *
   * Named apart from the node's own `rotation`, which orients the emitter.
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
   * Starting tint, display-space like every other colour in the engine
   *
   * Its own alpha is ignored; `alpha` sets opacity.
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
   * Constant acceleration; a bare number is shorthand for that much downward pull
   *
   * It is in the system's own space, like velocity, so in a `space: 'local'` system it turns and
   * scales with the node.
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
   * Ignored for a single texture.
   *
   * `'animate'` and `'overLife'` read the sheet as a grid of equal cells, left to right then top to
   * bottom from the top-left cell, and compute each particle's frame in the shader. The grid comes
   * from the first frame's size and the number of frames, not from where each frame sits, and every
   * frame must be on the same source or the constructor throws. `'random'` copies one frame's exact
   * region at spawn, so it is the mode for sheets whose frames are not laid out on a grid.
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
   * Seed for reproducible runs. Omit for a random seed
   * @example
   * ```ts
   * const replayable = new ParticleSystem3D({ seed: 'campfire' });
   * ```
   */
  seed?: string;
  /**
   * Whether {@link ParticleSystem3D.update | update} runs from `Ticker.shared` every frame
   *
   * Set `false` to drive updates yourself; {@link ParticleSystem3D.autoUpdate} says when you would.
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
   * Whether the system starts playing, emitting and running its burst timeline, as soon as it is built
   * @default true
   * @example
   * ```ts
   * const confetti = new ParticleSystem3D({ autoPlay: false, emitRate: 0, bursts: [{ time: 0, count: 300 }] });
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
 * Nothing moves on the CPU. A particle is written once when it is born: where
 * it started, which way it was going, when, and for how long. Every frame the
 * vertex shader works out where it is now from that record and the system
 * clock. The options you set decide which behaviour bits are composed into
 * that shader: a system with no `spin`, ramps or flipbook carries none of that
 * code. Lifetime and motion are always there; gravity and drag are uniforms.
 *
 * So the per-frame cost is emission plus one uniform, whatever the pool size,
 * and the upload each frame covers only the slots born that frame.
 *
 * Rendering, capacity and blending come from {@link ParticleContainer3D}, which
 * this extends. Drop to that layer when you want to drive particles yourself.
 * @typeParam B - The `extraBits` you pass. They type the custom attributes that `spawn`,
 *   `setParticle` and `onUpdate` accept; the system's own bits are typed by
 *   {@link ParticleSystemValues} instead.
 * @example
 * ```ts
 * // Campfire smoke.
 * const smoke = new ParticleSystem3D({
 *   texture: puff,
 *   capacity: 400,
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
 * @see {@link ParticleContainer3D} For the rendering layer underneath.
 * @category extras:particles
 * @standard
 */
export class ParticleSystem3D<B extends readonly ShaderBit[] = readonly ShaderBit[]> extends ParticleContainer3D<B> {
  /**
   * Where particles start and which way they head. Swap freely at runtime
   * @example
   * ```ts
   * thruster.shape = boosting ? new ConeShape({ angle: 8 }) : new ConeShape({ angle: 25 });
   * ```
   */
  public shape: EmitterShape;

  /**
   * Called at the end of each step, for effects the options don't cover
   *
   * Write through {@link ParticleSystem3D.setParticle | setParticle}, or through the raw
   * {@link ParticleContainer3D.data | data} views followed by
   * {@link ParticleContainer3D.markDirty | markDirty}; the step uploads the marked slots after
   * this returns. A slot written from scratch needs `aBirth` and `aLife` too, or the shader reads
   * it as long dead. Runs whether or not the system is {@link ParticleSystem3D.playing | playing}.
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

  private _gravity: Vector3 | null = null;
  private _drag: number | null = null;
  private readonly _frameMode: ParticleFrameMode;
  private _frameRate = 0;
  private readonly _hasShaderFlipbook: boolean;
  /** The sheet wrapper `deriveSetup` made for a shader flipbook, freed with the system; `null` when the caller's texture is bound as given */
  private readonly _gridSheet: Texture | null;

  private readonly _colorStart: number = 0;

  /** Every attribute a spawn writes; `createSpawnAttributes` sets the order */
  private readonly _spawnAttributes: SpawnAttribute[];
  /** The current burst's overrides, classified once; see `SpawnPlan` */
  private readonly _plan: SpawnPlan;
  /** What the spawn functions read, hoisted once; see `SpawnContext` */
  private readonly _spawnContext: SpawnContext;
  /** What shapes their code; see `SpawnShape` */
  private readonly _spawnShape: SpawnShape;
  /** The attribute list's signature, so systems with the same attributes share spawn functions */
  private readonly _spawnSignature: string;
  /** The spawn function for each override pattern this system has seen, keyed by the pattern */
  private readonly _spawns = new Map<string, SpawnFn>();
  /**
   * The emitter transform world-space spawns bake in. Refreshed from the live
   * parent chain once per burst rather than read from `worldTransform`, which
   * only the render pass keeps current: a system moved this frame, or spawning
   * before its first frame, emits from where it is
   */
  private readonly _spawnTransform = new Matrix4();

  /** Next slot to write. Slots recycle in order; the shader decides what is alive */
  private _cursor = 0;

  private _emitRate = 0;
  private _playing: boolean;
  private _accumulator = 0;
  /** Seconds into the burst timeline; advances while playing, moved by the goto methods */
  private _time = 0;
  /**
   * The clock births are stamped with and the shader reads
   *
   * Only `update` and the `time` setter move it. The goto methods never do, so they can't kill
   * live particles.
   */
  private _clock = 0;

  private _autoUpdate = false;

  /**
   * Default options for {@link ParticleSystem3D}, merged under every constructor call
   *
   * Mutate to change the defaults process-wide. A shape set here is one object shared by every
   * system that doesn't pass its own, so editing one system's `shape` edits them all.
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
  };

  /**
   * Creates a particle system
   *
   * Add it under a `View3D`'s root to render it.
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
      seed,
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

    const rng = seededRandom(seed ?? Math.random().toString(36));
    this.shape = shape!;
    this._bursts = [...(bursts ?? [])];
    this._gridSheet = setup.ownsTexture ? (setup.texture as Texture) : null;
    this._burstNext = new Float64Array(this._bursts.length);
    this.onUpdate = onUpdate ?? null;

    this._seek(0);

    this._emitRate = emitRate!;
    this._playing = autoPlay!;
    this._frameMode = frameMode!;
    this._frameRate = frameRate!;
    this._hasShaderFlipbook = setup.grid !== null;

    this._colorStart = packParticleColor(Color.shared.setValue(color!).toNumber(), 1);

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
      rng,
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
   * The system clock in seconds
   *
   * What births are stamped with and what the shader reads. Advances with
   * {@link ParticleSystem3D.update | update}.
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
   * Scrubs the clock
   *
   * Every particle is a pure function of its birth record and this value, so
   * assigning it renders that moment exactly, backwards included: particles
   * born after it are not yet born, particles whose life ended before it are
   * dead. Nothing is resimulated. Resuming continues from here, and new spawns
   * then recycle the oldest slots as usual.
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
   * Changes the steady emission rate; takes effect on the next step
   * @param value - Particles emitted per second.
   */
  set emitRate(value: number) {
    this._emitRate = value;
  }

  /**
   * Whether the system is emitting and running its burst timeline
   *
   * Change it with {@link ParticleSystem3D.play | play} and
   * {@link ParticleSystem3D.stop | stop}. Live particles keep moving and
   * ageing either way.
   * @example
   * ```ts
   * if (!fountain.playing) fountain.play();
   * ```
   */
  get playing(): boolean {
    return this._playing;
  }

  /**
   * Constant acceleration, or `null` when the system has none
   *
   * Assign a new value to change it: editing the returned vector doesn't reach the shader.
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
   *
   * It is a uniform, so every live particle feels the change on the next frame
   * and there is nothing to recompile.
   * @param value - Acceleration vector, a number `g` for a pull of `g` straight down, or `null` for none.
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
   * How fast velocity dies away, or `null` when the system has none;
   * {@link ParticleSystem3DOptions.drag} has the scale
   * @example
   * ```ts
   * bubbles.drag = underwater ? 4 : null;
   * ```
   */
  get drag(): number | null {
    return this._drag;
  }

  /**
   * Sets the drag. A uniform, like {@link ParticleSystem3D.gravity | gravity}
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
   * Changes the flipbook playback rate
   * @param value - Frames per second; only used when `frameMode` is `'animate'`.
   */
  set frameRate(value: number) {
    this._frameRate = value;
    if (this._hasShaderFlipbook && this._frameMode === 'animate') this.uniforms.uFrameRate = value;
  }

  /**
   * Whether {@link ParticleSystem3D.update | update} runs from `Ticker.shared` every frame
   *
   * The step runs at `UPDATE_PRIORITY.LOW + 1`: after code at the default `NORMAL` priority, so a
   * spawn bakes the emitter where this frame's game code left it, and before anything at `LOW`,
   * where an `Application` renders. That only orders it before the render when the application
   * is built with `sharedTicker: true`. A default application renders from a ticker of its own,
   * which the browser usually runs first, so new particles show a frame late. Turn this off and
   * call `update` from `app.ticker` to step before that render, or to step the system yourself
   * from a fixed-step loop or a test.
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
   * Connects to or disconnects from `Ticker.shared`
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
   * Live particles carry on until their lifetimes run out: the "close the tap,
   * let the smoke clear" behaviour. {@link ParticleSystem3D.clear | clear}
   * removes them at once; turning off
   * {@link ParticleSystem3D.autoUpdate | autoUpdate} freezes them in place.
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
   * `gotoAndPlay(0)` restarts the effect: every burst fires again on schedule.
   * Live particles aren't touched.
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
   * Moves the burst timeline to `time` and stops there
   *
   * Bursts scheduled before `time` count as spent; a repeating one picks up at
   * its next repeat. Live particles aren't touched, and the clock they render
   * against doesn't move; assign {@link ParticleSystem3D.time | time} to scrub
   * that.
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
   * Overflow recycles the oldest slots, and more than the capacity spawns the
   * capacity. The new particles upload with the next {@link ParticleSystem3D.update | update}.
   * @example
   * ```ts
   * sparks.spawn(30, { position: hit.point, color: 0xffaa00 });
   * ```
   * @param count - How many to emit.
   * @param overrides - Per-spawn values replacing the system's defaults.
   */
  public spawn(count: number, overrides?: ParticleSpawnOverrides<B>): void {
    const plan = this._plan;
    const o = overrides as Record<string, unknown> | undefined;

    if (o !== undefined) this._checkOverrides(o);

    const attributes = this._spawnAttributes;

    for (let i = 0; i < attributes.length; i++) {
      const key = attributes[i].key;
      const raw = key === '' ? undefined : o?.[key];
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
    plan.packedColor =
      o?.color === undefined
        ? this._colorStart
        : packParticleColor(Color.shared.setValue(o.color as ColorSource).toNumber(), 1);

    this._spawnBatch(Math.min(count, this.capacity));
  }

  /**
   * The container's {@link ParticleContainer3D.setParticle | setParticle}, also
   * accepting the attributes the system's own behaviour bits declare
   * @example
   * ```ts
   * sparks.setParticle(0, { aPosition: { x: 0, y: 2, z: 0 }, aBirth: sparks.time, aLife: 1.5 });
   * ```
   * @param index - Slot to write, in `[0, capacity)`.
   * @param values - Attribute name to value. An undeclared name throws.
   * @advanced
   */
  public override setParticle(index: number, values: ParticleValues<B> & ParticleSystemValues): void {
    super.setParticle(index, values);
  }

  /**
   * Advances the system by one tick and uploads whatever was born
   *
   * Runs every frame while {@link ParticleSystem3D.autoUpdate | autoUpdate} is on. Call it
   * yourself when driving the system from your own loop. Both clocks move before anything spawns:
   * a burst fires in the step that reaches its time, and a particle born in the step is stamped
   * with the time the shader reads, so it first draws at age 0, where it spawned. While the system
   * is stopped the clock still moves, so live particles finish their lives. To move the clock
   * without emitting, assign {@link ParticleSystem3D.time | time}.
   *
   * The step always comes from a ticker's `deltaMS`, so a fixed-step loop keeps a `Ticker` of its
   * own and writes its step into `deltaMS` before each call.
   * @example
   * ```ts
   * const step = new Ticker();
   *
   * step.deltaMS = 1000 / 120;
   * system.update(step); // one 120 Hz step, however long the frame took
   * ```
   * @param ticker - The ticker driving this update; its `deltaMS` is the step, capped at a tenth
   *   of a second. Omitted, one 60 fps frame is assumed.
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
   * Kills every particle immediately
   *
   * Emission carries on from where it was; use
   * {@link ParticleSystem3D.gotoAndPlay | gotoAndPlay(0)} to restart the burst
   * timeline too.
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
   * Disconnects from the ticker, tears down the buffer and frees the sheet wrapper a shader flipbook made
   *
   * The source under that wrapper is yours, so `options` decides its fate as for any texture you pass.
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
    super.destroy(options);
    this._gridSheet?.destroy(false);
  }

  /**
   * Puts the burst timeline at `time`, with each burst due at its first firing at or after it
   *
   * A non-finite time would poison the timeline (`NaN` never fires again, `Infinity` dumps a
   * pool's worth at once), so it is refused before anything moves.
   * @param time - Seconds into the burst timeline.
   * @throws {RangeError} If `time` is not a finite number
   */
  private _seek(time: number): void {
    if (!Number.isFinite(time)) {
      throw new RangeError(`[ParticleSystem3D] time must be a finite number of seconds, got ${time}`);
    }

    this._time = time;
    this._accumulator = 0;

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

  /**
   * Fires any bursts the timeline has reached since the last step
   *
   * A step longer than many repeat intervals owes a repeating burst many firings, but only the
   * last pool's worth can survive. Once that many have fired, the rest are skipped and the
   * schedule picks up from the present.
   */
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

  /** Marks every entry of the plan absent, for emission with no overrides */
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
   * Writes `count` new particles into the next slots, from the current plan
   *
   * Runs the spawn function for this plan's override pattern, kept per system by the pattern
   * alone. A pattern the system hasn't seen comes from `generateSpawnBurst`, whose cache every
   * system shares.
   * @param count - Particles to write; never more than the capacity, so the run wraps the pool at most once.
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

  /**
   * Rejects an override the system has no attribute for, or one shaped wrong
   * for its attribute, once per burst: either would otherwise write nothing or
   * NaN with no error
   * @param o - The override object passed to `spawn()`.
   */
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

  /** Refreshes `_spawnTransform` from the live parent chain */
  private _refreshSpawnTransform(): void {
    updateTransformBackwards3D(this, _parentWorld.identity());

    if (this._localTransformDirty) {
      this.updateLocalTransform();
      this._localTransformDirty = false;
    }

    _parentWorld.multiply(this.localTransform, this._spawnTransform);
  }
}

/**
 * Every attribute a spawn writes, built-in or not, as one list in the order its random draws happen
 *
 * The order fixes which draw each attribute gets, so reordering the list changes what every seed
 * produces. The attributes the caller's `extraBits` declare come last and are written as zero
 * unless an override names them. A user bit that redeclares a built-in, to type `setParticle` say,
 * gets no entry of its own, which would write zero over the built-in's value.
 * @param offsets - Byte offset of each attribute in a vertex, from the container's `data.offsets`
 * @param options - The options that decide which attributes exist
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
  if (sizeEnd !== undefined) attributes.push(entry('', 'aSizeEnd', 0, 1, FROM_SPREAD, SPREAD.sizeEnd, AS_F32));
  if (alphaEnd !== undefined) attributes.push(entry('', 'aAlphaEnd', 0, 1, FROM_SPREAD, SPREAD.alphaEnd, AS_F32));
  if (spin !== undefined) attributes.push(entry('', 'aSpin', 0, 1, FROM_SPREAD, SPREAD.spin, AS_F32));
  if (colorEnd !== undefined) {
    const packed = packParticleColor(Color.shared.setValue(colorEnd).toNumber(), 1);

    attributes.push(entry('', 'aColorEnd', 0, 4, FROM_PACKED, 0, AS_PACKED, packed));
  }

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
