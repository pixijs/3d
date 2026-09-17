import { clearList } from 'pixi.js';

import { Matrix4 } from '../../math/matrix/Matrix4';
import { Container3D } from '../Container3D';
import type { View3D } from '../View3D';

/**
 * Singleton sentinel used as a stand-in parent for scene roots, so the
 * recursive update never has to null-check `container.parent`
 *
 * Its `worldTransform` stays at identity and `worldVisible` stays at 1, so
 * `parent.worldTransform * local` and `parent.worldVisible * _visible`
 * produce the correct root values without a branch.
 *
 * Module-private: must NEVER be mutated, parented, or added to a scene.
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
 * Skips re-enqueued containers whose `view3d` or `_relativeSceneDepth` have
 * shifted since they were queued (re-parented into another render group or
 * to a different depth) — those will be picked up by the matching depth
 * bucket. Increments `view3d._updateTick` once per call so re-entrant work
 * within the same frame dedupes correctly.
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

      // Stale-queue guard: if the child was re-parented into another View3D, or
      // to a different scene depth, since it enqueued, skip it — the update that
      // matches its current view/depth bucket will handle it.
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
 * bucket earlier in the same pass is skipped on revisit.
 *
 * Dirty propagation:
 * - `transformDirty` and `visibleDirty` OR in `container`'s own
 *   `_worldTransformDirty` / `_worldVisibleDirty` so an ancestor change
 *   cascades to descendants.
 * - Matrix multiply runs only when the container is visible AND the chain
 *   reports a transform change; hidden subtrees skip matrix math but
 *   preserve `_worldTransformDirty` so reshow recomputes correctly.
 * - `_localTransformDirty` is consumed (cleared) only when the local matrix
 *   is actually rebuilt, so a pending pose change on a hidden container
 *   survives until the next visible frame.
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

  // Cleared at the START so any re-entrant setters during the work
  // can safely re-enqueue this container for next frame.
  container.didChange = false;

  // OR own dirty signals into the cascade.
  transformDirty ||= container._worldTransformDirty;
  visibleDirty ||= container._worldVisibleDirty;

  // Resolve world visibility only when the chain reports a visibility change.
  // Multiplicative 0|1 cascade — the same shape extends to GPU-side
  // cull masks (frustum * occlusion * layer * visibility) when GPU
  // culling lands.
  if (visibleDirty) {
    container._worldVisible = parent._worldVisible * container._visible;
  }

  // Matrix work only fires when both:
  //  - the subtree is visible (hidden subtrees skip work; transformDirty
  //    is preserved on the container below so reshow recomputes), and
  //  - some transform actually changed in this chain (own or ancestor).
  // A visibility-only flip therefore costs zero matrix math.
  if (container._worldVisible && transformDirty) {
    // Local matrix only depends on THIS container's own pos/rot/scale.
    // Skip it when only an ancestor moved — _localTransformDirty is the
    // self-only signal the setters set; consume it here.
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

    // Invalidate transform-derived caches (Mesh3D.boundingSphere, the picker's
    // per-node inverse in Container3D._getInverseWorldTransform) — the world matrix changed.
    container._worldTransformId++;
    // Publish the matrix now, while it is hot: a mesh writes its store row here rather than
    // leaving the scene sweep to re-read it cold later in the frame.
    container._storeWorldTransform();
  }

  // Visibility is resolved (either to 1 or 0) for this frame — always clear.
  container._worldVisibleDirty = false;
  // Visible: matrix work either ran or wasn't needed — safe to clear.
  // Hidden: preserve so reshow picks up the pending world-matrix recompute.
  // _localTransformDirty is untouched: it's only cleared when actually
  // consumed above, so a hidden container with a pending local change keeps
  // the flag and recomputes on reshow.
  container._worldTransformDirty = container._worldVisible ? false : transformDirty;

  const children = container.children;
  const length = children.length;

  for (let i = 0; i < length; i++) {
    updateTransformAndChildren3D(children[i], container, updateTick, transformDirty, visibleDirty);
  }
}
