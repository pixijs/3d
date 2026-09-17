import type { MorphStoreBuffer } from '../core/buffers/MorphStoreBuffer';

/**
 * Per-mesh morph-target state: blend weights plus the mesh's slot in the renderer-shared morph store
 *
 * The {@link Morph.weights | weights} are driven by the animation system.
 * A {@link Mesh3D} creates one only when its geometry has morph targets, so
 * presence doubles as the "is morphed" check — `if (mesh.morph)` reads like
 * `if (mesh.skeleton)` does for skinning — and non-morphed meshes carry a
 * single `undefined` instead of the slot bookkeeping.
 * @see {@link Mesh3D.morph} For the mesh property that holds this state.
 * @category scene
 * @standard
 */
export class Morph {
  /**
   * Per-target blend weights, one float per morph target
   *
   * Mutate freely (the animation system writes in place); the renderer diffs them against the
   * weight slot each frame and uploads only actual changes.
   */
  public weights: Float32Array;

  /**
   * Absolute float offset of the weights in `uMorphStorage`, baked into the store row
   * (MESH3D_LANE_MORPH_WEIGHT)
   *
   * Derived each frame from the store's weights base + `_slot`; it moves only when the delta
   * arena grows, and the scene update re-emits the row exactly then.
   * @internal
   */
  public _weightIndex = 0;
  /**
   * Weight slot relative to the store's weights base; `-1` when unallocated
   * @internal
   */
  public _slot = -1;
  /**
   * Bucket size the slot was allocated with (frees must match the allocation)
   * @internal
   */
  public _slotSize = 0;
  /**
   * The shared store the slot lives in, so detach/destroy can free it
   * without renderer context. `null` when unallocated.
   * @internal
   */
  public _store: MorphStoreBuffer | null = null;

  /** @param weights - Per-target blend weights, one float per morph target */
  constructor(weights: Float32Array) {
    this.weights = weights;
  }
}
