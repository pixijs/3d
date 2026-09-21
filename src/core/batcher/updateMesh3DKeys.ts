import type { AlphaMode } from '../../materials/BaseMaterial3D';

/**
 * A mesh carries two keys per pass, and they follow deliberately different rules
 *
 * **`batchKey` is identity.** The batcher starts a new draw command the moment it changes,
 * so two meshes sharing a key are drawn with the *first* one's shader, state and index
 * range. Truncating or hashing either half would let unrelated meshes compare equal and
 * silently render as each other, so both halves are carried exactly:
 *
 *   `pipelineId * 2^32 + geometry.uid`
 *
 * **`_sortKey` is locality.** It only decides draw order, so lossy fields are fine here —
 * a collision costs adjacency, never correctness. 53 bits, packed to stay an exact Float64:
 *
 *   Cutout (1)  |  TextureLayoutId (4)  |  Pipeline (16)  |  Geometry (16)  |  Texture (16)
 *   bit 52         bits 48-51              bits 32-47         bits 16-31        bits 0-15
 *
 * Cutout (`alphaMode: 'mask'`) is the top bit, so alpha-tested meshes draw after the opaque
 * ones in the same batch. Their fragment shader can `discard`, so the GPU cannot write depth
 * before shading them. When they draw first, the GPU shades every layer of foliage in full,
 * including what the walls drawn later hide. When they draw last, the depth test rejects those
 * fragments before shading. The bit is part of the mesh's single sort key, so every key-sorted
 * pass gets the order, including the depth-only shadow pass, where nothing discards and the
 * order gains nothing.
 *
 * Then textureLayoutId (`_textures.length`, clamped to the field's 15) so items group by
 * texture count. Without the clamp a 16-texture opaque material would set the cutout bit, and
 * a 17-texture one would carry into it.
 *
 * Pipeline and geometry group within that, which is what lands same-draw meshes
 * adjacent for the batcher to fuse. Texture is lowest — a soft hint keeping same-albedo
 * items together to maximise texture-slot reuse. Atlased geometry sorts by its atlas
 * first so draws sharing the merged buffers stay contiguous and skip re-binding it.
 */
const PIPELINE_OFFSET = 0x1_0000_0000; // 2^32 — clears the geometry uid packed below it
const GEOM_OFFSET = 1 << 16; // 2^16
const GEOM_MASK = 0xffff;
const TEX_MASK = 0xffff;
const PIPE_MASK = 0xffff;
const LAYOUT_OFFSET = GEOM_OFFSET * GEOM_OFFSET * GEOM_OFFSET; // 2^48
/** Largest texture count the 4-bit layout field holds; larger counts share its group */
const LAYOUT_MAX = 15;
const CUTOUT_OFFSET = LAYOUT_OFFSET * (LAYOUT_MAX + 1); // 2^52
/** Bits of the atlas uid packed above the geometry uid in the sort key's geometry field */
const ATLAS_SHIFT = 12;

/**
 * Backend pipeline key → a small id counted up from zero, allocated the first time a key
 * is seen. Same shape as `passBitRegistry`: the real key is only ever compared, never
 * decoded, so a compact stand-in does the job.
 *
 * It earns its place because neither backend's real key fits. WebGPU's graphics-state key
 * runs past bit 45; WebGL's spans a shader uid plus its packed state and topology. The
 * batch key has to hold one of those *and* a 32-bit geometry uid exactly inside a Float64.
 * A counted id fits, which keeps a batch break at one number compare in the hottest loop in
 * the engine — the alternative is carrying the full key in its own field and comparing
 * several values per mesh per draw.
 *
 * Global and never freed, like pixi's `uid()`. It holds numbers only, and it's bounded by
 * how many distinct pipelines the app builds — the same population the shader cache holds.
 * Ids stay exact in the batch key up to 2^21 pipelines.
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
 * Computes and writes `cache.batchKey` and the mesh's `_sortKey` in a single pass
 *
 * The caller passes the pass-cache entry it already holds, so the pass being keyed for is
 * implicit in `cache` and the sparse `_passCache[bit]` dictionary is probed once per dirty
 * mesh instead of twice.
 *
 * - `batchKey` = pipeline+geometry — used for batch break detection.
 * - `_sortKey` = cutout+textureLayoutId+pipeline+geometry+texture — used for sort ordering,
 *   with cutout materials last within a batch and textureLayoutId next so items group by
 *   texture layout.
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
