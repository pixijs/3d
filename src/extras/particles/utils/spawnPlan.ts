import type { Matrix4 } from '../../../math/matrix/Matrix4';
import type { PointData3D } from '../../../math/vector/PointData3D';
import type { Vector3 } from '../../../math/vector/Vector3';
import type { EmitterShape } from '../emitterShapes/EmitterShape';

/**
 * No override given: the attribute takes its own source
 *
 * The kinds say how one override was given for a burst, classified once so the
 * per-particle loop switches on an integer rather than re-inspecting the value.
 * @internal
 */
export const ABSENT = 0;
/** One value every particle in the burst gets @internal */
export const CONSTANT = 1;
/** A `[lo, hi]` pair each particle draws between @internal */
export const PAIR = 2;
/** A function called per particle with the random source and the slot index @internal */
export const FUNCTION = 3;

/**
 * Classifies a spawn value as `ABSENT`, `CONSTANT`, `PAIR` or `FUNCTION`
 * @param value - One override as given to `spawn()`, or `undefined` when none was
 * @returns The kind.
 * @internal
 */
export function kindOf(value: unknown): number {
  if (value === undefined) return ABSENT;
  if (typeof value === 'function') return FUNCTION;
  if (Array.isArray(value)) return PAIR;

  return CONSTANT;
}

/**
 * Zero, for an attribute a user bit declared and nothing else sources
 *
 * The sources say where a spawn attribute's value comes from when no override
 * names it.
 * @internal
 */
export const FROM_ZERO = 0;
/** The system's `[min, max]` spread at `SpawnAttribute.spread` @internal */
export const FROM_SPREAD = 1;
/** The birth clock @internal */
export const FROM_CLOCK = 2;
/** The shape's direction times a speed drawn from the speed spread @internal */
export const FROM_VELOCITY = 3;
/** A constant packed integer, `SpawnAttribute.packed` @internal */
export const FROM_PACKED = 4;
/** A random flipbook window, or frame zero @internal */
export const FROM_FRAME = 5;

/**
 * Stored as floats, one per component
 *
 * The stores say how a resolved value lands in the vertex row.
 * @internal
 */
export const AS_F32 = 0;
/** The burst's tint with this value as its alpha byte @internal */
export const AS_TINT = 1;
/** `{ x, y, z, w }` in 0..1 packed to four bytes @internal */
export const AS_UNORM8 = 2;
/** `{ x, y, z, w }` in 0..1 packed to four shorts @internal */
const AS_UNORM16 = 3;
/** A frame window copied from the frame table @internal */
export const AS_FRAME = 4;
/** A packed integer stored as-is @internal */
export const AS_PACKED = 5;

/**
 * One attribute a spawn writes, resolved once at construction
 *
 * Every attribute the system's bits declare is one of these, built-in or not;
 * what differs is only where its value comes from and how it is stored.
 * @internal
 */
export interface SpawnAttribute {
  /** The key it may be overridden under in a `spawn()` object, or `''` when it can't be */
  key: string;
  /** Float index of the attribute's first element in a vertex */
  index: number;
  /** Component within the attribute this entry fills: `size` is `aParticleSizeRot.x`, `startRotation` its `y` */
  offset: number;
  /** How many components this entry writes, 1 to 4 */
  components: number;
  /** Where the value comes from with no override: `FROM_ZERO` and friends */
  source: number;
  /** The spread's offset, when the source is a spread */
  spread: number;
  /** The constant, when the source is a packed integer */
  packed: number;
  /** How the value is stored: `AS_F32` and friends */
  store: number;
}

/**
 * One burst's overrides, classified once and kept parallel to the attribute list
 *
 * Reused across bursts so classifying allocates nothing.
 * @internal
 */
export interface SpawnPlan {
  /** Each attribute's kind: `ABSENT`, `CONSTANT`, `PAIR` or `FUNCTION` */
  kind: number[];
  /** Each attribute's override as given, for a constant or a function */
  raw: unknown[];
  /** Each pair's first endpoint */
  lo: unknown[];
  /** Each pair's second endpoint */
  hi: unknown[];
  /** The position override's kind; the shape's business, not an attribute's, so it is kept apart */
  position: number;
  /** The position override as given, for a constant or a function */
  positionRaw: unknown;
  /** A position pair's first endpoint */
  positionLo: PointData3D;
  /** A position pair's second endpoint */
  positionHi: PointData3D;
  /** The burst's tint, packed once */
  packedColor: number;
}

/** The origin, standing in for a position pair's endpoints when none was given @internal */
export const ZERO3: PointData3D = { x: 0, y: 0, z: 0 };

/**
 * Components in a vertex format, read off its name: `float32x3` → 3, `float32` → 1
 * @param format - A vertex format name
 * @returns The component count, 1 to 4.
 * @internal
 */
export function componentsOf(format: string): number {
  const m = /x(\d)$/.exec(format);

  return m ? Number(m[1]) : 1;
}

/**
 * How a spawn stores an attribute of this format
 * @param format - The attribute's vertex format name
 * @returns One of the `AS_*` stores, or `-1` for a format with no packer.
 * @internal
 */
export function storeFor(format: string): number {
  if (format.startsWith('float32')) return AS_F32;
  if (format === 'unorm8x4') return AS_UNORM8;
  if (format === 'unorm16x4') return AS_UNORM16;

  return -1;
}

/**
 * What a spawn function reads
 *
 * The system's scratch, views and per-system values, handed in as one object
 * and hoisted into locals per burst.
 * @internal
 */
export interface SpawnContext {
  /**
   * The system's random source
   *
   * Always `seededRandom`, with a random seed when none was given: `Math.random` allocates on
   * every call, and a spawn draws about eight times per particle.
   */
  rng: () => number;
  /** The system's `[min, max]` spread table */
  spreads: Float32Array;
  /** The emitter shape sampled for each particle */
  shape: EmitterShape;
  /** Scratch the shape writes its position into */
  pos: Vector3;
  /** Scratch the shape writes its direction into */
  dir: Vector3;
  /** Scratch for a position pair's draw */
  origin3: Vector3;
  /** The emitter transform world-space spawns bake in */
  worldTransform: Matrix4;
  /** The container's frame table, four shorts per frame */
  packedFrames: Uint16Array;
  /** Frames in the flipbook, 1 without one */
  frameCount: number;
  /** Each attribute's packed constant, parallel to the attribute list; zero unless its source is `FROM_PACKED` */
  packed: Uint32Array;
  /** Slots in the pool, where the write cursor wraps */
  capacity: number;
  /** The vertex buffer as floats */
  f32: Float32Array;
  /** The vertex buffer as 32-bit words */
  u32: Uint32Array;
  /** The vertex buffer as 16-bit halves */
  u16: Uint16Array;
}

/**
 * A spawn function: writes `count` particles from slot `first` for one
 * override pattern, and returns the slot after the last one written
 * @internal
 */
export type SpawnFn = (ctx: SpawnContext, plan: SpawnPlan, clock: number, first: number, count: number) => number;

/**
 * What shapes a spawn function's code beyond the attribute list, fixed for a
 * system's lifetime
 * @internal
 */
export interface SpawnShape {
  /** Floats per vertex */
  floatStride: number;
  /** Whether spawns bake the emitter's transform in */
  world: boolean;
  /** Whether the frame attribute draws a random frame, or always frame zero */
  randomFrames: boolean;
}
