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

/** Offsets of each spawn spread's `[min, max]` pair */
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
 * A backgrounded tab hands back a huge `deltaMS`; without a ceiling every
 * particle would teleport on the first frame after the user returns.
 */
const MAX_STEP = 1 / 10;

const _pos = new Vector3();
const _dir = new Vector3();
const _origin3 = new Vector3();
const _parentWorld = new Matrix4();

/**
 * A scheduled burst of particles, listed in {@link ParticleSystem3DOptions.bursts}
 * @category extras:particles
 * @standard
 */
export interface ParticleBurst {
  /** Seconds into the system's burst timeline when the burst fires */
  time: number;
  /** How many particles it emits */
  count: number;
  /** Repeat interval in seconds. Omit for a one-shot */
  repeatEvery?: number;
}

/**
 * How a flipbook advances, chosen by {@link ParticleSystem3DOptions.frameMode}
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
  /** Particles emitted per second. Set to 0 for a burst-only or fully manual system @default 10 */
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
   */
  bursts?: readonly ParticleBurst[];
  /** Where particles start and which way they head @default `new PointShape()` */
  shape?: EmitterShape;

  /** Lifetime in seconds @default 1 */
  life?: ParticleSpread;
  /** Initial speed along the shape's direction @default 0 */
  speed?: ParticleSpread;
  /** Starting world-space diameter @default 1 */
  size?: ParticleSpread;
  /**
   * Each particle's starting spin angle about the view axis, in radians
   *
   * Named apart from the node's own `rotation`, which orients the emitter.
   * @default 0
   */
  startRotation?: ParticleSpread;
  /** Rotation rate in radians per second. Omit to leave particles unspinning */
  spin?: ParticleSpread;
  /** Starting opacity @default 1 */
  alpha?: ParticleSpread;
  /** Starting tint, display-space like every other colour in the engine. Its own alpha is ignored; `alpha` sets opacity @default 0xffffff */
  color?: ColorSource;

  /** End-of-life size. Omit to hold the spawn size */
  sizeEnd?: ParticleSpread;
  /** End-of-life opacity — set it to 0 for the standard fade-out. Omit to hold the spawn opacity */
  alphaEnd?: ParticleSpread;
  /** End-of-life tint. Omit to hold the spawn tint */
  colorEnd?: ColorSource;

  /** Constant acceleration; a bare number is shorthand for that much downward pull */
  gravity?: number | PointData3D;
  /** Velocity damping per second */
  drag?: number;

  /**
   * How a multi-frame system picks frames
   *
   * One at random per particle, played at
   * {@link ParticleSystem3DOptions.frameRate}, or stretched across the
   * particle's life. Ignored for single-sprite systems.
   *
   * `'animate'` and `'overLife'` read the sheet as a grid of equal cells, left
   * to right then top to bottom, and compute each particle's frame in the
   * shader. `'random'` copies one frame's exact region at spawn, so it is the
   * mode for sheets whose frames are not laid out on a grid.
   * @default 'random'
   */
  frameMode?: ParticleFrameMode;
  /** Frames per second for `frameMode: 'animate'` @default 12 */
  frameRate?: number;

  /** Seed for reproducible runs. Omit for `Math.random` */
  seed?: string;
  /**
   * Whether {@link ParticleSystem3D.update | update} runs from `Ticker.shared` every frame
   *
   * Set `false` to drive updates yourself.
   * @default true
   */
  autoUpdate?: boolean;
  /**
   * Whether the system starts playing, emitting and running its burst timeline, as soon as it is built
   * @default true
   */
  autoPlay?: boolean;

  /** Called at the end of each step; see {@link ParticleSystem3D.onUpdate} */
  onUpdate?: ((dt: number, system: ParticleSystem3D<B>) => void) | null;
}

/**
 * A particle system with the movement built in: emission, lifetimes, spreads,
 * forces and over-life ramps, all from one options object
 *
 * Nothing moves on the CPU. A particle is written once when it is born — where
 * it started, which way it was going, when, and for how long — and every frame
 * the vertex shader works out where it is now from that record and the system
 * clock. The options you set decide which behaviour bits are composed into
 * that shader: a system with no `spin`, ramps or flipbook carries none of that
 * code. Lifetime and motion are always there; gravity and drag are uniforms.
 *
 * So the per-frame cost is emission plus one uniform, whatever the pool size,
 * and the upload each frame covers only the slots born that frame.
 *
 * Rendering, capacity and blending come from {@link ParticleContainer3D}, which
 * this extends. Drop to that layer when you want to drive particles yourself.
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
  /** Where particles start and which way they head. Swap freely at runtime */
  public shape: EmitterShape;

  /**
   * Called at the end of each step, for effects the options don't cover
   *
   * Write through {@link ParticleContainer3D.setParticle | setParticle} or the
   * raw {@link ParticleContainer3D.data | data} views; the upload happens
   * afterwards. A slot written from scratch needs `aBirth` and `aLife` too, or
   * the shader reads it as long dead. Runs whether or not the system is
   * {@link ParticleSystem3D.playing | playing}.
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
  private _frameRate: number;
  private readonly _hasShaderFlipbook: boolean;
  /** The sheet wrapper `deriveSetup` made for a shader flipbook, freed with the system; `null` when the caller's texture is bound as given */
  private readonly _gridSheet: Texture | null;

  private readonly _colorStart: number;

  /**
   * Every attribute a spawn writes, in the order their random draws happen,
   * resolved once from the layout; see `SpawnAttribute`
   */
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

  private _emitRate: number;
  private _playing: boolean;
  private _accumulator = 0;
  /** Seconds into the burst timeline; advances while playing, moved by the goto methods */
  private _time = 0;
  /** The clock births are stamped in and the shader reads. Never rewinds */
  private _clock = 0;

  private _autoUpdate = false;

  /**
   * Default options for {@link ParticleSystem3D}, merged under every constructor call
   *
   * Mutate to change the defaults process-wide.
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
    // The container derives its vertex layout from its bits inside super(), so
    // everything the options imply about the shader is resolved first.
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

    // The container gets the full list; its type parameter stays the caller's
    // extras, which is what spawn and setParticle are typed from.
    // Joining a parent waits for the finished system, as in the container.
    super({
      label: 'ParticleSystem3D',
      ...rest,
      texture: setup.texture,
      extraBits: [...setup.bits, ...(extraBits ?? [])] as unknown as B,
    });

    const rng = seed === undefined ? Math.random : seededRandom(seed);
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

    const offsets = this.data.offsets;
    const at = (name: string): number => offsets[name] / 4;
    // Every attribute the built-in entries write, so a user bit that redeclares
    // one (to type setParticle, say) doesn't get a second, zeroing entry.
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

    // Every attribute a spawn writes, built-in or not, as one list in the order
    // its random draws happen. Velocity leads because it draws the speed.
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
      // The end tint is sRGB-decoded once here; the bit blends it against the
      // spawn tint in linear space, so both go into the buffer already linear.
      const packed = packParticleColor(Color.shared.setValue(colorEnd).toNumber(), 1);

      attributes.push(entry('', 'aColorEnd', 0, 4, FROM_PACKED, 0, AS_PACKED, packed));
    }

    // Whatever the caller's bits declared is written too, at zero unless an
    // override names it.
    for (const [name, format] of Object.entries(collectAttributes([...(extraBits ?? [])]))) {
      if (owned.has(name) || offsets[name] === undefined) continue;

      const store = storeFor(format);

      if (store < 0) {
        throw new Error(`[ParticleSystem3D] cannot spawn into '${name}': no packer for the format '${format}'.`);
      }

      attributes.push(entry(name, name, 0, componentsOf(format), FROM_ZERO, 0, store));
    }

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

  /** Particles emitted per second */
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
   */
  get playing(): boolean {
    return this._playing;
  }

  /** Constant acceleration, or `null` when the system has none */
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

  /** Velocity damping per second, or `null` when the system has none */
  get drag(): number | null {
    return this._drag;
  }

  /**
   * Sets the damping. A uniform, like {@link ParticleSystem3D.gravity | gravity}
   * @param value - Velocity damping per second, or `null` for none.
   */
  set drag(value: number | null) {
    this._drag = value;
    this.uniforms.uDrag = value ?? 0;
  }

  /** Frames per second for `frameMode: 'animate'` */
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
   * The step runs at `UPDATE_PRIORITY.LOW + 1`, just above the `LOW` priority an `Application`
   * renders at, so a spawn reads the emitter's transform as this frame's game code left it. Turn it
   * off to step the system yourself, from your own ticker or a test.
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
      // Just above the application's render (UPDATE_PRIORITY.LOW), not the HIGH an AnimatedSprite
      // uses: a sprite frame doesn't care where the node is, but a spawn bakes the emitter's world
      // transform and runs onUpdate, so it has to come after the NORMAL-priority code that moves
      // the emitter and sets up the frame.
      Ticker.shared.add(this._onTick, undefined, UPDATE_PRIORITY.LOW + 1);
    } else {
      Ticker.shared.remove(this._onTick);
    }
  }

  /** Resumes emitting, and the burst timeline, from where {@link ParticleSystem3D.stop | stop} left them */
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
   */
  public stop(): void {
    this._playing = false;
  }

  /**
   * Moves the burst timeline to `time` and plays from there
   *
   * `gotoAndPlay(0)` restarts the effect: every burst fires again on schedule.
   * Live particles aren't touched.
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
   * capacity.
   * @param count - How many to emit.
   * @param overrides - Per-spawn values replacing the system's defaults.
   */
  public spawn(count: number, overrides?: ParticleSpawnOverrides<B>): void {
    const plan = this._plan;
    const o = overrides as Record<string, unknown> | undefined;

    if (o !== undefined) this._checkOverrides(o);

    // Everything about the overrides that is the same for every particle in the
    // burst is worked out here, once: which attributes are named, in which form,
    // a pair's endpoints, and the tint as a packed integer.
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
   * @param index - Slot to write, in `[0, capacity)`.
   * @param values - Attribute name to value. An undeclared name throws.
   */
  public override setParticle(index: number, values: ParticleValues<B> & ParticleSystemValues): void {
    super.setParticle(index, values);
  }

  /**
   * Advances the system by one tick and uploads whatever was born
   *
   * Runs every frame while {@link ParticleSystem3D.autoUpdate | autoUpdate} is on. Call it
   * yourself when driving the system from your own loop. The clock moves first, so a particle
   * spawned this step is stamped with the time the shader will read and is on screen in the same
   * step: bursts appear the frame they fire, not one frame late. While the system is stopped the
   * clock still moves, so live particles finish their lives. To move the clock without emitting,
   * assign {@link ParticleSystem3D.time | time}.
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
   * timeline too. A zeroed slot has no lifetime, so the shader reads it as long
   * dead.
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
   * @param options - Teardown flags; see {@link Destroy3DOptions}.
   */
  public override destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;
    this.autoUpdate = false;
    this.onUpdate = null;
    super.destroy(options);
    // The wrapper is this system's own; the source under it is the caller's.
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

  /** Fires any bursts the timeline has reached since the last step */
  private _emitBursts(): void {
    const bursts = this._bursts;

    for (let b = 0; b < bursts.length; b++) {
      const burst = bursts[b];
      let next = this._burstNext[b];

      // A long stall owes many repeats, but only the last pool's worth can
      // survive, so once that many have fired the rest are skipped.
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
   * Runs the spawn function for this plan's override pattern: looked up here
   * by the pattern alone, and past that from the cache every system shares,
   * which makes it on first sight.
   * @param count - Particles to write; never more than the capacity.
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

    // `count` never exceeds the capacity, so the run wraps at most once.
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
