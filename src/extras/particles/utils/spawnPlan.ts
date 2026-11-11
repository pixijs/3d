import type { Matrix4 } from '../../../math/matrix/Matrix4';
import type { PointData3D } from '../../../math/vector/PointData3D';
import type { Vector3 } from '../../../math/vector/Vector3';
import type { EmitterShape } from '../emitterShapes/EmitterShape';

/** @internal */
export const ABSENT = 0;
/** @internal */
export const CONSTANT = 1;
/** @internal */
export const PAIR = 2;
/** @internal */
export const FUNCTION = 3;

/** @internal */
export function kindOf(value: unknown): number {
  if (value === undefined) return ABSENT;
  if (typeof value === 'function') return FUNCTION;
  if (Array.isArray(value)) return PAIR;

  return CONSTANT;
}

/** @internal */
export const FROM_ZERO = 0;
/** @internal */
export const FROM_SPREAD = 1;
/** @internal */
export const FROM_CLOCK = 2;
/** @internal */
export const FROM_VELOCITY = 3;
/** @internal */
export const FROM_PACKED = 4;
/** @internal */
export const FROM_FRAME = 5;

/** @internal */
export const AS_F32 = 0;
/** The burst's tint, with this value as its alpha byte @internal */
export const AS_TINT = 1;
/** @internal */
export const AS_UNORM8 = 2;
const AS_UNORM16 = 3;
/** @internal */
export const AS_FRAME = 4;
/** @internal */
export const AS_PACKED = 5;

/** @internal */
export interface SpawnAttribute {
  /** The attribute's key in a `spawn()` overrides object; `''` when it can't be overridden */
  key: string;
  /** Float index from the start of a vertex, not a byte offset */
  index: number;
  /** The component it starts at: `size` is `aParticleSizeRot.x`, `startRotation` its `y` */
  offset: number;
  components: number;
  /** A `FROM_*` constant */
  source: number;
  spread: number;
  packed: number;
  /** An `AS_*` constant */
  store: number;
}

/**
 * One burst's overrides, parallel to the attribute list; reused so classifying allocates nothing
 * @internal
 */
export interface SpawnPlan {
  kind: number[];
  raw: unknown[];
  lo: unknown[];
  hi: unknown[];
  position: number;
  positionRaw: unknown;
  positionLo: PointData3D;
  positionHi: PointData3D;
  packedColor: number;
}

/** @internal */
export const ZERO3: PointData3D = { x: 0, y: 0, z: 0 };

/** @internal */
export function componentsOf(format: string): number {
  const m = /x(\d)$/.exec(format);

  return m ? Number(m[1]) : 1;
}

/**
 * The `AS_*` store for a vertex format, or `-1` when there's no packer for it
 * @internal
 */
export function storeFor(format: string): number {
  if (format.startsWith('float32')) return AS_F32;
  if (format === 'unorm8x4') return AS_UNORM8;
  if (format === 'unorm16x4') return AS_UNORM16;

  return -1;
}

/** @internal */
export interface SpawnContext {
  rng: () => number;
  spreads: Float32Array;
  shape: EmitterShape;
  pos: Vector3;
  dir: Vector3;
  origin3: Vector3;
  worldTransform: Matrix4;
  packedFrames: Uint16Array;
  frameCount: number;
  /** Parallel to the attribute list; `spawn()` swaps an override in for one burst, then restores it */
  packed: Uint32Array;
  capacity: number;
  f32: Float32Array;
  u32: Uint32Array;
  u16: Uint16Array;
}

/**
 * Writes `count` particles from slot `first` and returns the next slot, wrapped
 * @internal
 */
export type SpawnFn = (ctx: SpawnContext, plan: SpawnPlan, clock: number, first: number, count: number) => number;

/** @internal */
export interface SpawnShape {
  floatStride: number;
  world: boolean;
  randomFrames: boolean;
}
