import type { MorphStoreBuffer } from '../core/buffers/MorphStoreBuffer';

/**
 * A mesh's morph weights and its slot in the shared morph store; `Mesh3D._morph` holds one only
 * while the geometry has morph targets
 * @internal
 */
export class Morph {
  public weights: Float32Array;

  /**
   * Absolute float offset of the weights in the morph store, which the mesh's store row carries
   * @internal
   */
  public _weightIndex = 0;
  /**
   * Weight slot relative to the store's weights base; `-1` when unallocated
   * @internal
   */
  public _slot = -1;
  /**
   * Bucket size the slot was allocated with, which freeing it must match
   * @internal
   */
  public _slotSize = 0;
  /**
   * The store that holds the slot, so the mesh can free it without the renderer; `null` when unallocated
   * @internal
   */
  public _store: MorphStoreBuffer | null = null;

  constructor(weights: Float32Array) {
    this.weights = weights;
  }
}
