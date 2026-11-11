import { clearList } from 'pixi.js';

import { Matrix4 } from '../../math/matrix/Matrix4';
import { Container3D } from '../Container3D';
import type { View3D } from '../View3D';

/**
 * Parent for roots, so the update never null-checks; its identity `worldTransform` and `worldVisible` of 1 must
 * never change
 */
const TEMP_PARENT_3D = /* @__PURE__ */ (() => {
  const p = new Container3D();
  p._worldVisible = 1;
  return p;
})();

/**
 * Skips a queued container whose view or depth changed after it was queued, since the queue where it is now has it
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
 * Updates a subtree once per `updateTick`; clears `didChange` first, so a setter run mid-update re-queues, and leaves a
 * hidden node's transform dirty flags set for when it's shown
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
    container._storeWorldVisible();
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
