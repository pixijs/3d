import type { State, Topology } from 'pixi.js';

/** Room for the `polygonOffset` id: 8 bits, so 256 distinct values; nothing checks for more */
const OFFSET_BITS = 256;
/** Room for the topology id: 3 bits, for pixi's 5 topologies */
const TOPOLOGY_BITS = 8;
/** Room for the blend mode id: 5 bits, for pixi's 11 blend modes */
const BLEND_BITS = 32;
/** Room for `State.data`: 8 bits, of which pixi's `STATE_BITS` uses 6 */
const DATA_BITS = 256;
/**
 * Total room below the shader uid: 8 + 5 + 3 + 8 = 24 bits
 * @internal
 */
export const GL_STATE_KEY_RANGE = DATA_BITS * BLEND_BITS * TOPOLOGY_BITS * OFFSET_BITS;

/** Topology → dense id, pinned to pixi's `Topology` union by the budget test */
const TOPOLOGY_IDS: Record<Topology, number> = {
  'point-list': 0,
  'line-list': 1,
  'line-strip': 2,
  'triangle-list': 3,
  'triangle-strip': 4,
};

/** Dense ids for the distinct `polygonOffset` values seen so far, never freed */
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
 * The exact WebGL draw identity for a (shader, state, topology) triple
 *
 * Packs what a WebGL draw command applies once for its whole run into one number, so the batcher
 * breaks a run with a single compare:
 *
 * ```text
 * shader uid | data (8 bits) | blend mode (5) | topology (3) | polygonOffset id (8)
 * ```
 *
 * Every field keeps its own bits. Folding two distinct states onto one key would fuse their draws
 * and render the later meshes with the first one's state, so the widths are budgets.
 * `packGlBatchKey.test.ts` pins each against pixi's own tables, so a pixi upgrade that outgrows
 * one fails there. `polygonOffset` is an arbitrary float, so it's interned to a dense id rather
 * than packed; an app has few distinct values, usually just zero.
 *
 * The key stays an exact Float64 integer while `shaderUid` is under 2^29. Pixi's shader uids count
 * the shaders created, which grow with material variants rather than scene size.
 * @param shaderUid - Uid of the compiled shader
 * @param state - Render state whose applied fields are packed by value
 * @param topology - Primitive topology of the draw
 * @returns The packed key, which `updateMesh3DKeys` combines with the geometry into the batch key
 * @internal
 */
export function packGlBatchKey(shaderUid: number, state: State, topology: Topology): number {
  const stateKey =
    ((state.data * BLEND_BITS + state._blendModeId) * TOPOLOGY_BITS + TOPOLOGY_IDS[topology]) * OFFSET_BITS +
    getOrAllocateOffsetId(state.polygonOffset);

  return shaderUid * GL_STATE_KEY_RANGE + stateKey;
}
