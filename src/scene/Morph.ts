import type { MorphStoreBuffer } from '../core/buffers/MorphStoreBuffer';

/**
 * A mesh's morph target weights, plus its place in the renderer's shared morph storage
 *
 * A {@link Mesh3D} has one only when its geometry has morph targets, so `mesh.morph` doubles as
 * the check for a morphed mesh, as {@link Mesh3D#skeleton} does for a skinned one. To read and
 * write the weights, {@link Mesh3D#weights} is the shorter path.
 * @example
 * ```ts
 * const face = model.getChildByLabel('Face', true);
 *
 * if (face instanceof Mesh3D && face.morph) face.morph.weights[0] = 1;
 * ```
 * @see {@link Mesh3D#morph} For the mesh property that holds this state.
 * @category scene
 * @standard
 */
export class Morph {
  /**
   * Blend weight of each morph target, one per target
   *
   * Write into it at any time; animations write into it too. Each frame the renderer compares it
   * with the values it last uploaded and uploads only the weights that changed.
   *
   * Keep the array and change its values rather than assigning a new one. An animation already
   * playing keeps writing the old array, and the primitives of one glTF mesh share a single array,
   * so a new one cuts this mesh loose from both.
   * @example
   * ```ts
   * face.morph.weights[smileIndex] = 0.8;
   * ```
   */
  public weights: Float32Array;

  /**
   * Absolute float offset of the weights in `uMorphStorage`, which the mesh's store row carries in
   * `MESH3D_LANE_MORPH_WEIGHT`
   *
   * Derived each frame from the store's weights base plus `_slot`. It moves only when the delta
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
   * Bucket size the slot was allocated with, which freeing it must match
   * @internal
   */
  public _slotSize = 0;
  /**
   * The shared store the slot lives in, so detaching or destroying the mesh can free it without
   * the renderer; `null` when unallocated
   * @internal
   */
  public _store: MorphStoreBuffer | null = null;

  /** @param weights - Blend weight of each morph target, one per target */
  constructor(weights: Float32Array) {
    this.weights = weights;
  }
}
