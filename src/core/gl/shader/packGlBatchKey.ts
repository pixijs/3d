import type { State, Topology } from 'pixi.js';

/**
 * Packs the things a WebGL draw command applies once for its whole run — shader, render
 * state, topology — into one exact number, so the batcher's break is a single compare
 *
 * Every field keeps its own bits. Folding two distinct states onto one key is not a
 * near-miss, it fuses their draws and renders the later meshes with the first's state, so
 * the widths below are budgets rather than guesses. `packGlBatchKey.test.ts` pins each one
 * against pixi's own tables; upstream growing past a budget fails there instead of here.
 *
 *   shader uid (29) | data (8) | blend mode (5) | topology (3) | polygonOffset id (8)
 *
 * `polygonOffset` is the one field that isn't a small integer — it's an arbitrary float —
 * so it's interned to a dense id instead of packed directly. Distinct values in an app are
 * few (usually just zero), and interning keeps the key exact where truncating a float
 * would not.
 */
const OFFSET_BITS = 256; // 8 bits — distinct polygonOffset values
const TOPOLOGY_BITS = 8; // 3 bits — pixi has 5 topologies
const BLEND_BITS = 32; // 5 bits — pixi has 11 blend modes
const DATA_BITS = 256; // 8 bits — pixi's State.data uses 6 (STATE_BITS)
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

/** Distinct `polygonOffset` values → dense ids; see the float note above */
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
 * Stays inside Float64's exact-integer range while `shaderUid` is under 2^29 — a counter of
 * compiled shaders, which is bounded by material variants rather than by scene size.
 * @param shaderUid - Uid of the compiled shader
 * @param state - Render state whose applied fields are packed by value
 * @param topology - Primitive topology of the draw
 * @returns The packed batch key
 * @internal
 */
export function packGlBatchKey(shaderUid: number, state: State, topology: Topology): number {
  const stateKey =
    ((state.data * BLEND_BITS + state._blendModeId) * TOPOLOGY_BITS + TOPOLOGY_IDS[topology]) * OFFSET_BITS +
    getOrAllocateOffsetId(state.polygonOffset);

  return shaderUid * GL_STATE_KEY_RANGE + stateKey;
}
