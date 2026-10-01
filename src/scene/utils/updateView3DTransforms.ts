import { clearList } from 'pixi.js';

import { Matrix4 } from '../../math/matrix/Matrix4';
import { Container3D } from '../Container3D';
import type { View3D } from '../View3D';

/**
 * Stand-in parent for scene roots, so the recursive update never has to null-check
 * `container.parent`
 *
 * Its `worldTransform` stays at identity and `worldVisible` stays at 1, so
 * `parent.worldTransform * local` and `parent.worldVisible * _visible` give a root its
 * own values without a branch. Never mutate it, parent it, or add it to a scene.
 */
const TEMP_PARENT_3D = /* @__PURE__ */ (() => {
  const p = new Container3D();
  p._worldVisible = 1;
  return p;
})();

/**
 * Per-frame transform pass for a {@link View3D}
 *
 * Drains the depth-bucketed work queue populated by `View3D._onChildUpdate`,
 * in ancestor-before-descendant order, and recomputes `worldTransform` /
 * `worldVisible` for every container in each dirty subtree via
 * {@link updateTransformAndChildren3D}.
 *
 * Skips a queued container whose `_view3d` or `_relativeSceneDepth` changed after it was
 * queued, because it moved to another View3D or to another depth: the queue for where it is
 * now picks it up. Increments `view3d._updateTick` once per call, so a container reached twice
 * in one pass is updated once.
 * @param view3d - the View whose dirty containers should be flushed
 * @internal
 */
export function updateView3DTransforms(view3d: View3D) {
  const childrenToUpdate = view3d._childrenToUpdate;

  const updateTick = view3d._updateTick++;

  for (const j in childrenToUpdate) {
    const renderGroupDepth = Number(j);

    const childrenAtDepth = childrenToUpdate[j];

    const list = childrenAtDepth.list;
    const index = childrenAtDepth.index;

    for (let i = 0; i < index; i++) {
      const child = list[i];

      if (child._view3d === view3d && child._relativeSceneDepth === renderGroupDepth) {
        const parent = child.parent ?? TEMP_PARENT_3D;
        updateTransformAndChildren3D(child, parent, updateTick, false, false);
      }
    }

    clearList(list, index);

    childrenAtDepth.index = 0;
  }
}

/**
 * Recursively recomputes `worldTransform` and `worldVisible` for `container`
 * and its descendants, multiplying parent transforms down the chain
 *
 * Dedupes via `updateTick` so a container visited from a shallower depth
 * bucket earlier in the same pass is skipped on revisit. `didChange` is cleared
 * first, so a setter that runs during the update can queue the container again
 * for the next frame.
 *
 * Dirty propagation:
 * - `transformDirty` and `visibleDirty` OR in `container`'s own
 *   `_worldTransformDirty` / `_worldVisibleDirty` so an ancestor change
 *   cascades to descendants.
 * - World visibility is the product of the 0/1 flags down the chain, resolved
 *   only when the chain reports a visibility change.
 * - Matrix work runs only when the container is visible and the chain reports
 *   a transform change, so a visibility-only flip costs no matrix math. Hidden
 *   subtrees keep `_worldTransformDirty` so showing them again recomputes.
 * - The local matrix is rebuilt only when the container's own position,
 *   rotation or scale changed, not when only an ancestor moved.
 *   `_localTransformDirty` is cleared only then, so a pending pose change on a
 *   hidden container survives until it is shown.
 *
 * A recomputed world matrix bumps `_worldTransformId`, which caches such as
 * `Mesh3D.boundingSphere` and the picker's `_getInverseWorldTransform` compare
 * against, and is published at once through `_storeWorldTransform`: a mesh
 * writes its store row while the matrix is hot, rather than the scene sweep
 * reading it cold later in the frame.
 * @param container - container being updated this step
 * @param parent - resolved parent for the multiply (may be `TEMP_PARENT_3D` for roots)
 * @param updateTick - per-frame dedupe tick from `view3d._updateTick`
 * @param transformDirty - whether some ancestor's transform changed
 * @param visibleDirty - whether some ancestor's visibility changed
 * @internal
 */
export function updateTransformAndChildren3D(
  container: Container3D,
  parent: Container3D,
  updateTick: number,
  transformDirty: boolean,
  visibleDirty: boolean,
) {
  if (updateTick === container._updateTick) return;
  container._updateTick = updateTick;

  container.didChange = false;

  transformDirty ||= container._worldTransformDirty;
  visibleDirty ||= container._worldVisibleDirty;

  if (visibleDirty) {
    container._worldVisible = parent._worldVisible * container._visible;
  }

  if (container._worldVisible && transformDirty) {
    if (container._localTransformDirty) {
      container.updateLocalTransform();
      container._localTransformDirty = false;
    }

    Matrix4.multiplyAffine(
      container.worldTransform.elements as Float32Array,
      0,
      parent.worldTransform.elements as Float32Array,
      0,
      container.localTransform.elements as Float32Array,
      0,
    );

    container._worldTransformId++;
    container._storeWorldTransform();
  }

  container._worldVisibleDirty = false;
  container._worldTransformDirty = container._worldVisible ? false : transformDirty;

  const children = container.children;
  const length = children.length;

  for (let i = 0; i < length; i++) {
    updateTransformAndChildren3D(children[i], container, updateTick, transformDirty, visibleDirty);
  }
}
