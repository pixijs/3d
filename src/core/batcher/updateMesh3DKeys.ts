import type { AlphaMode } from '../../materials/BaseMaterial3D';

/** 2^32: puts the pipeline id above a whole 32-bit geometry uid in the batch key, and at bit 32 of the sort key */
const PIPELINE_OFFSET = 0x1_0000_0000;
/** 2^16: the geometry field's place in the sort key */
const GEOM_OFFSET = 1 << 16;
const GEOM_MASK = 0xffff;
const TEX_MASK = 0xffff;
const PIPE_MASK = 0xffff;
/** 2^48: the layout field's place in the sort key */
const LAYOUT_OFFSET = GEOM_OFFSET * GEOM_OFFSET * GEOM_OFFSET;
/** Largest texture count the 4-bit layout field holds; larger counts share its group */
const LAYOUT_MAX = 15;
/** 2^52: the cutout bit, the top bit of the sort key */
const CUTOUT_OFFSET = LAYOUT_OFFSET * (LAYOUT_MAX + 1);
/** Geometry-uid bits kept under the atlas uid in the sort key's geometry field, leaving the atlas uid four */
const ATLAS_SHIFT = 12;

/**
 * Each backend pipeline key's small id, counted up from zero the first time the key is seen
 *
 * The real key is only ever compared, never decoded, so a compact stand-in does the job, as in
 * `passBitRegistry`. Neither backend's real key fits: WebGPU's pipeline key runs past bit 45, and
 * WebGL's packs a shader uid with the state and topology. The batch key has to hold one of those
 * and a 32-bit geometry uid exactly in one Float64. A counted id fits, which keeps a batch break at
 * one number compare in the hottest loop in the engine, instead of several compares per mesh.
 *
 * Global and never freed, like pixi's `uid()`. It holds only numbers, one per distinct pipeline
 * the app builds, the same count the shader cache holds. Ids stay exact in the batch key up to
 * 2^21 pipelines.
 */
const pipelineIdsByKey = new Map<number, number>();
let nextPipelineId = 0;

function getOrAllocatePipelineId(key: number): number {
  let id = pipelineIdsByKey.get(key);

  if (id === undefined) {
    id = nextPipelineId++;
    pipelineIdsByKey.set(key, id);
  }

  return id;
}

/** The mesh fields that feed its batch and sort keys */
interface KeyedMesh {
  _sortKey: number;
  geometry: { uid: number; _geometryAtlasAllocation: { atlas: { uid: number } } | null };
  material: { textureCacheKey: number; _textures: { length: number }; alphaMode: AlphaMode };
}

/**
 * Writes a mesh's batch key into its pass-cache entry and its sort key onto the mesh
 *
 * The two keys follow different rules.
 *
 * **`batchKey` is identity.** The batcher starts a new draw command the moment it changes, so
 * meshes that share a key draw with the first one's shader, state and index range. Truncating or
 * hashing either half would let unrelated meshes compare equal and render as each other, so both
 * halves are exact: `pipelineId * 2^32 + geometry.uid`.
 *
 * **`_sortKey` is locality.** It only decides draw order, so its fields can be lossy: a collision
 * costs adjacency, never correctness. It packs 53 bits, so it stays an exact Float64:
 *
 * | Bits  | Field    | Holds |
 * |-------|----------|-------|
 * | 52    | Cutout   | 1 for `alphaMode: 'mask'` |
 * | 48-51 | Layout   | `_textures.length`, clamped to 15 |
 * | 32-47 | Pipeline | the pipeline id's low 16 bits |
 * | 16-31 | Geometry | the geometry uid's low 16 bits, or for atlased geometry the atlas's and the geometry's |
 * | 0-15  | Texture  | the material's `textureCacheKey` |
 *
 * Cutout meshes sort last because their fragment shader can `discard`, so the GPU can't test depth
 * before shading them. Drawn first, every layer of foliage is shaded in full, even what the walls
 * drawn later hide. Drawn last, the depth test rejects those fragments before shading. The bit is
 * in the mesh's one sort key, so every key-sorted pass gets the order, including the depth-only
 * shadow pass, where nothing discards and the order gains nothing.
 *
 * Clamping the layout keeps a 16-texture opaque material from setting the cutout bit, and a
 * 17-texture one from carrying into it. Pipeline and geometry put meshes that can share a draw next
 * to each other for the batcher. Atlased geometry puts the atlas uid's low 4 bits over the geometry
 * uid's low 12, so draws that share the merged buffers stay together. Texture is the lowest field,
 * a soft hint that keeps meshes with the same first texture together so the batch reuses its slots.
 *
 * The caller passes the pass-cache entry it already holds, so the sparse `_passCache` is probed
 * once per dirty mesh rather than twice.
 * @param renderable - The mesh whose `_sortKey` is written
 * @param cache - The pass-cache entry whose `batchKey` is written
 * @param cache.batchKey - Receives the pipeline+geometry batch key
 * @param pipelineKey - Backend pipeline key, mapped to a compact pipeline id
 * @internal
 */
export function updateMesh3DKeys(renderable: KeyedMesh, cache: { batchKey: number }, pipelineKey: number): void {
  const pipelineId = getOrAllocatePipelineId(pipelineKey);
  const geometry = renderable.geometry;
  const alloc = geometry._geometryAtlasAllocation;

  cache.batchKey = pipelineId * PIPELINE_OFFSET + geometry.uid;

  const geomLocality = alloc ? (alloc.atlas.uid << ATLAS_SHIFT) | (geometry.uid & 0xfff) : geometry.uid;

  renderable._sortKey =
    (renderable.material.alphaMode === 'mask' ? CUTOUT_OFFSET : 0) +
    Math.min(renderable.material._textures.length, LAYOUT_MAX) * LAYOUT_OFFSET +
    (pipelineId & PIPE_MASK) * PIPELINE_OFFSET +
    (geomLocality & GEOM_MASK) * GEOM_OFFSET +
    (renderable.material.textureCacheKey & TEX_MASK);
}
