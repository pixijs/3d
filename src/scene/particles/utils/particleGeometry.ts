import { Buffer, BufferUsage, createIndicesForQuads } from 'pixi.js';

/**
 * Vertices one particle occupies: the four corners of its quad
 * @internal
 */
export const VERTS_PER_PARTICLE = 4;

/**
 * Indices one particle occupies: two triangles
 * @internal
 */
export const INDICES_PER_PARTICLE = 6;

/**
 * Largest capacity a 16-bit index buffer can address (65536 / 4 verts)
 * @internal
 */
export const MAX_U16_CAPACITY = 16384;

/**
 * The static `aUV` buffer, one corner id per vertex in the order {@link cornerIds} writes
 *
 * The particle bit reads the id as a `[-0.5, 0.5]` corner offset and the material
 * reads it as the sprite's UV. `unorm8x2` holds an exact 0 and 1 in half the bytes
 * two floats take, once its stride is padded to the 4 bytes WebGPU requires.
 * @param vertexCount - Vertices to cover, four per quad
 * @internal
 */
function buildUvBuffer(vertexCount: number): Buffer {
  return new Buffer({
    data: cornerIds(vertexCount),
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    label: 'particle-corners',
    shrinkToFit: false,
  });
}

/**
 * The corner ids for `vertexCount` vertices, four to a quad: `(0, 1)`, `(1, 1)`, `(1, 0)`, `(0, 0)`
 *
 * Each id takes 4 bytes, `u` and `v` then padding, so only the 255s need writing;
 * corner 3 is all zero. The order runs round the quad's edge, so
 * `createIndicesForQuads`' `0-1-2 / 0-2-3` split covers it, and since the particle
 * bit puts `v = 0` on the top edge it winds counter-clockwise on screen.
 * @param vertexCount - Vertices to cover, four per quad
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

/**
 * Quad indices via pixi's own generator, the one its 2D `ParticleContainer`
 * uses
 *
 * The buffer is supplied here because pixi keys its u16/u32 switch on index
 * count; the real u16 ceiling is the max vertex index, at 16384 quads.
 * @param capacity - Quads to cover; past `MAX_U16_CAPACITY` the indices are 32-bit
 * @internal
 */
function buildIndices(capacity: number): Uint16Array | Uint32Array {
  const indices =
    capacity <= MAX_U16_CAPACITY
      ? new Uint16Array(capacity * INDICES_PER_PARTICLE)
      : new Uint32Array(capacity * INDICES_PER_PARTICLE);

  return createIndicesForQuads(capacity, indices) as Uint16Array | Uint32Array;
}

/**
 * A corner buffer and an index buffer every container draws from
 *
 * The corner ids repeat for every quad and the indices are the same six per
 * quad stepped by four, so one pair covering the largest capacity seen serves
 * everyone, each geometry drawing its own prefix through `indexCount`.
 * @internal
 */
export interface SharedQuadBuffers {
  /** The per-corner `aUV` ids, four per quad */
  readonly corners: Buffer;
  /** Six indices per quad, `u16` up to `MAX_U16_CAPACITY` quads and `u32` past it */
  readonly indices: Buffer;
  /** Quads the pair covers */
  capacity: number;
  /** Live containers drawing from the pair */
  users: number;
}

/** Quads the first pair covers; a bigger request doubles from there */
const MIN_SHARED_QUADS = 256;

/** One pair per index width, so a small container never pays for 32-bit indices */
let shared16: SharedQuadBuffers | null = null;
let shared32: SharedQuadBuffers | null = null;

/**
 * The shared pair covering at least `capacity` quads, grown in place when the
 * current one is too small
 *
 * Growth reallocates both buffers, which every container drawing from them
 * picks up on its next bind, and the pair never shrinks. It lives as long as
 * a container holds it: `acquireQuadBuffers` counts a container in,
 * `releaseQuadBuffers` counts it out and destroys the pair on the last one,
 * and the next acquire builds a fresh pair.
 *
 * Plain pixi `Buffer`s rather than `Buffer3D`: every draw build that records a
 * container captures them like any other geometry buffer, so a reallocation's
 * `change` event re-records the bundles and VAOs that baked the old ones, and
 * pixi's GC may reclaim the pair while no container draws.
 * @param capacity - Fewest quads the pair must cover
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
 * The shared pair covering at least `capacity` quads, held by one more
 * container until its `releaseQuadBuffers`
 * @param capacity - Fewest quads the pair must cover
 * @internal
 */
export function acquireQuadBuffers(capacity: number): SharedQuadBuffers {
  const pair = ensureQuadBuffers(capacity);

  pair.users++;

  return pair;
}

/**
 * Lets go of a pair taken with `acquireQuadBuffers`, destroying it once no
 * container holds it
 * @param pair - The pair `acquireQuadBuffers` returned
 * @internal
 */
export function releaseQuadBuffers(pair: SharedQuadBuffers): void {
  if (--pair.users > 0) return;

  pair.corners.destroy();
  pair.indices.destroy();

  if (shared16 === pair) shared16 = null;
  else if (shared32 === pair) shared32 = null;
}
