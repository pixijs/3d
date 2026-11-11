import type { State, Topology } from 'pixi.js';

/** 8 bits for the `polygonOffset` id; a 257th distinct value overflows into the topology bits, unchecked */
const OFFSET_BITS = 256;
/** 3 bits, for pixi's 5 topologies */
const TOPOLOGY_BITS = 8;
/** 5 bits, for pixi's 11 blend modes */
const BLEND_BITS = 32;
/** 8 bits for `State.data`, of which pixi's `STATE_BITS` uses 6 */
const DATA_BITS = 256;
/** @internal */
export const GL_STATE_KEY_RANGE = DATA_BITS * BLEND_BITS * TOPOLOGY_BITS * OFFSET_BITS;

const TOPOLOGY_IDS: Record<Topology, number> = {
  'point-list': 0,
  'line-list': 1,
  'line-strip': 2,
  'triangle-list': 3,
  'triangle-strip': 4,
};

/** Never freed: an app has few distinct `polygonOffset` values, usually just 0 */
const offsetIds = new Map<number, number>();
let nextOffsetId = 0;

function getOrAllocateOffsetId(offset: number): number {
  let id = offsetIds.get(offset);

  if (id === undefined) {
    id = nextOffsetId++;
    offsetIds.set(offset, id);
  }

  return id;
}

/**
 * Packs the shader, state and topology a WebGL draw applies per run into one number. Each field keeps its own bits,
 * which `packGlBatchKey.test.ts` checks, so no two states share a key; exact while `shaderUid` is under 2^29.
 * @internal
 */
export function packGlBatchKey(shaderUid: number, state: State, topology: Topology): number {
  const stateKey =
    ((state.data * BLEND_BITS + state._blendModeId) * TOPOLOGY_BITS + TOPOLOGY_IDS[topology]) * OFFSET_BITS +
    getOrAllocateOffsetId(state.polygonOffset);

  return shaderUid * GL_STATE_KEY_RANGE + stateKey;
}
