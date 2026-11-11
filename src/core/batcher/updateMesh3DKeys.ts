import { State } from 'pixi.js';

import type { AlphaMode } from '../../materials/BaseMaterial3D';
import { copyState } from '../../utils/copyState';

const PIPELINE_OFFSET = 0x1_0000_0000;
const FIELD_MASK = 0xfff;
const GEOM_OFFSET = 1 << 12;
const TEXTURE_SET_OFFSET = 1 << 24;
const TEXTURE_SET_MASK = 0xffff;
const PIPELINE_SORT_OFFSET = 2 ** 40;
const PIPELINE_FIELD_MASK = 0xff;
const LAYOUT_OFFSET = 2 ** 48;
const LAYOUT_MAX = 15;
const CUTOUT_OFFSET = LAYOUT_OFFSET * (LAYOUT_MAX + 1);
const ATLAS_SHIFT = 8;

/** Counted ids for the backends' pipeline keys, never freed, like pixi's `uid()`; exact in a batch key up to 2^21 */
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

const pipelineStates: State[] = [];

/**
 * The pipeline's own copy of a mesh's state, never freed, for commands to bind, since materials change theirs in place
 *
 * It's exact while the pipeline key covers every field a draw applies (`packGlBatchKey` on WebGL).
 * @internal
 */
export function pipelineState(batchKey: number, state: State): State {
  const id = Math.floor(batchKey / PIPELINE_OFFSET);
  let copy = pipelineStates[id];

  if (!copy) {
    copy = pipelineStates[id] = new State();
    copyState(copy, state);
  }

  return copy;
}

interface KeyedMesh {
  _sortKey: number;
  geometry: { uid: number; _geometryAtlasAllocation: { atlas: { uid: number } } | null };
  material: { uid: number; _textures: ArrayLike<unknown>; _textureSetId: number; alphaMode: AlphaMode };
}

/**
 * Writes a mesh's batch key into its pass-cache entry and its sort key onto the mesh
 *
 * The batch key, `pipelineId * 2^32 + geometry.uid`, stays exact: equal keys draw as one. Sort keys may collide.
 * Cutout meshes sort last, so the depth test rejects their hidden fragments before they shade, and material
 * lowest, so a run meets each material once.
 * @param renderable - The mesh whose `_sortKey` is written
 * @param cache - The pass-cache entry the caller already holds, which receives the batch key
 * @param pipelineKey - The backend's pipeline key
 * @internal
 */
export function updateMesh3DKeys(renderable: KeyedMesh, cache: { batchKey: number }, pipelineKey: number): void {
  const pipelineId = getOrAllocatePipelineId(pipelineKey);
  const geometry = renderable.geometry;
  const alloc = geometry._geometryAtlasAllocation;

  cache.batchKey = pipelineId * PIPELINE_OFFSET + geometry.uid;

  const geomLocality = alloc ? (alloc.atlas.uid << ATLAS_SHIFT) | (geometry.uid & 0xff) : geometry.uid;
  const material = renderable.material;

  renderable._sortKey =
    (material.alphaMode === 'mask' ? CUTOUT_OFFSET : 0) +
    Math.min(material._textures.length, LAYOUT_MAX) * LAYOUT_OFFSET +
    (pipelineId & PIPELINE_FIELD_MASK) * PIPELINE_SORT_OFFSET +
    (material._textureSetId & TEXTURE_SET_MASK) * TEXTURE_SET_OFFSET +
    (geomLocality & FIELD_MASK) * GEOM_OFFSET +
    (material.uid & FIELD_MASK);
}
