import { Buffer, BufferUsage, createIndicesForQuads } from 'pixi.js';

/** @internal */
export const VERTS_PER_PARTICLE = 4;

/** @internal */
export const INDICES_PER_PARTICLE = 6;

/** @internal */
export const MAX_U16_CAPACITY = 16384;

function buildUvBuffer(vertexCount: number): Buffer {
  return new Buffer({
    data: cornerIds(vertexCount),
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    label: 'particle-corners',
    shrinkToFit: false,
  });
}

/**
 * Corners `(0, 1)`, `(1, 1)`, `(1, 0)`, `(0, 0)` round the quad's edge, as `createIndicesForQuads`
 * splits it, padded to the 4-byte stride WebGPU requires, which `ParticleContainer3D` gives `aUV`
 */
function cornerIds(vertexCount: number): Uint8Array {
  const data = new Uint8Array(vertexCount * 4);

  for (let v = 0; v < vertexCount; v += VERTS_PER_PARTICLE) {
    const o = v * 4;

    data[o + 1] = 255;
    data[o + 4] = 255;
    data[o + 5] = 255;
    data[o + 8] = 255;
  }

  return data;
}

/** Passes pixi its own array, since pixi moves to 32-bit indices by index count, not by the highest index */
function buildIndices(capacity: number): Uint16Array | Uint32Array {
  const indices =
    capacity <= MAX_U16_CAPACITY
      ? new Uint16Array(capacity * INDICES_PER_PARTICLE)
      : new Uint32Array(capacity * INDICES_PER_PARTICLE);

  return createIndicesForQuads(capacity, indices);
}

/**
 * The corner and index buffers every container draws a prefix of, through its geometry's `indexCount`
 * @internal
 */
export interface SharedQuadBuffers {
  readonly corners: Buffer;
  readonly indices: Buffer;
  capacity: number;
  users: number;
}

const MIN_SHARED_QUADS = 256;

/** One pair per index width, so a small container never draws with 32-bit indices */
let shared16: SharedQuadBuffers | null = null;
let shared32: SharedQuadBuffers | null = null;

/**
 * The shared pair covering at least `capacity` quads, grown in place when too small
 *
 * Plain pixi `Buffer`s, so a growth's `change` event re-records the draws that baked the old ones.
 * @internal
 */
export function ensureQuadBuffers(capacity: number): SharedQuadBuffers {
  const wide = capacity > MAX_U16_CAPACITY;
  let current = wide ? shared32 : shared16;

  if (current === null || current.corners.destroyed || current.indices.destroyed) {
    const size = wide ? capacity : Math.min(Math.max(capacity, MIN_SHARED_QUADS), MAX_U16_CAPACITY);

    current = {
      corners: buildUvBuffer(size * VERTS_PER_PARTICLE),
      indices: new Buffer({
        data: buildIndices(size),
        usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
        label: 'particle-indices',
        shrinkToFit: false,
      }),
      capacity: size,
      users: 0,
    };

    if (wide) shared32 = current;
    else shared16 = current;

    return current;
  }

  if (current.capacity < capacity) {
    let size = Math.max(capacity, current.capacity * 2);

    if (!wide) size = Math.min(size, MAX_U16_CAPACITY);

    current.corners.data = cornerIds(size * VERTS_PER_PARTICLE);
    current.indices.data = buildIndices(size);
    current.capacity = size;
  }

  return current;
}

/**
 * {@link ensureQuadBuffers}, counting one more user until its {@link releaseQuadBuffers}
 * @internal
 */
export function acquireQuadBuffers(capacity: number): SharedQuadBuffers {
  const pair = ensureQuadBuffers(capacity);

  pair.users++;

  return pair;
}

/**
 * Lets go of a pair taken with {@link acquireQuadBuffers}, destroying it once no container holds it
 * @internal
 */
export function releaseQuadBuffers(pair: SharedQuadBuffers): void {
  if (--pair.users > 0) return;

  pair.corners.destroy();
  pair.indices.destroy();

  if (shared16 === pair) shared16 = null;
  else if (shared32 === pair) shared32 = null;
}
