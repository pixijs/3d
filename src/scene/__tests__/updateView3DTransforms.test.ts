import { describe, expect, it, vi } from 'vitest';

import { MESH3D_STORE_STRIDE } from '~/core/buffers/Mesh3DDataStoreBuffer';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { updateTransformAndChildren3D, updateView3DTransforms } from '~/scene/utils/updateView3DTransforms';
import { View3D } from '~/scene/View3D';

// A blank Container3D is shape-equivalent to the production-side TEMP_PARENT_3D
// sentinel (identity worldTransform, worldVisible=1) — so we can use one as the
// stand-in parent in tests without depending on an internal export.
const tempParent = new Container3D();

let tickCounter = 0;
const nextTick = () => ++tickCounter;

const visit = (root: Container3D) => {
  updateTransformAndChildren3D(root, tempParent, nextTick(), false, false);
};

describe('updateTransformAndChildren3D — visibility propagation', () => {
  it('root container worldVisible === _visible (no parent to inherit from)', () => {
    const root = new Container3D();
    visit(root);
    expect(root.worldVisible).toBe(1);

    root.visible = false;
    visit(root);
    expect(root.worldVisible).toBe(0);
  });

  it('child inherits invisible from any ancestor regardless of own visible flag', () => {
    const root = new Container3D();
    const mid = new Container3D();
    const leaf = new Container3D();

    root.addChild(mid);
    mid.addChild(leaf);

    root.visible = false;
    leaf.visible = true; // explicitly visible — should still resolve to 0

    visit(root);

    expect(root.worldVisible).toBe(0);
    expect(mid.worldVisible).toBe(0);
    expect(leaf.worldVisible).toBe(0);
  });

  it('descendant with visible=false stays hidden when ancestor is visible', () => {
    const root = new Container3D();
    const child = new Container3D();
    root.addChild(child);

    child.visible = false;

    visit(root);

    expect(root.worldVisible).toBe(1);
    expect(child.worldVisible).toBe(0);
  });

  it('clears all dirty flags after each visible visit', () => {
    const root = new Container3D();
    const child = new Container3D();
    root.addChild(child);

    visit(root);

    expect(root._worldTransformDirty).toBe(false);
    expect(root._worldVisibleDirty).toBe(false);
    expect(child._worldTransformDirty).toBe(false);
    expect(child._worldVisibleDirty).toBe(false);
  });

  it('clears didChange after each visit', () => {
    const root = new Container3D();
    const child = new Container3D();
    root.addChild(child);
    root.didChange = true;
    child.didChange = true;

    visit(root);

    expect(root.didChange).toBe(false);
    expect(child.didChange).toBe(false);
  });
});

describe('updateTransformAndChildren3D — hidden subtree skip optimisation', () => {
  it('does NOT recompute worldTransform for a hidden subtree when descendant transforms change', () => {
    const root = new Container3D();
    const child = new Container3D();
    root.addChild(child);

    // Initial pass: matrices computed, position is (0, 0, 0).
    visit(root);
    const initialChildX = child.worldTransform.elements[12];
    expect(initialChildX).toBe(0);

    // Hide the parent (cascades to child)
    root.visible = false;
    visit(root);
    expect(child.worldVisible).toBe(0);

    // Mutate the child's position. Because the child's worldVisible is 0,
    // the next pass should NOT update its worldTransform.
    child.position.x = 99;
    visit(root);

    expect(child.worldTransform.elements[12]).toBe(initialChildX); // still old value
  });

  it('flipping ancestor back to visible recomputes hidden descendants matrices in one pass', () => {
    const root = new Container3D();
    const child = new Container3D();
    root.addChild(child);

    visit(root);

    root.visible = false;
    visit(root);

    // Mutate while hidden — change is staged but matrix not yet recomputed
    child.position.x = 42;
    visit(root);
    expect(child.worldTransform.elements[12]).not.toBe(42);

    // Show the root again — descendants should pick up the staged change
    root.visible = true;
    visit(root);

    expect(root.worldVisible).toBe(1);
    expect(child.worldVisible).toBe(1);
    expect(child.worldTransform.elements[12]).toBe(42);
  });
});

describe('updateTransformAndChildren3D — work-skipping by flag', () => {
  it('visibility-only flip does NOT recompute world matrix or set _storeDirty', () => {
    const root = new Container3D();
    const child = new Container3D();
    root.addChild(child);

    // Prime: full update so matrices exist and _storeDirty is consumed.
    visit(root);
    root._storeDirty = false;
    child._storeDirty = false;

    const childWorldBefore = new Float32Array(child.worldTransform.elements as Float32Array);
    const childStoreSpy = vi.spyOn(child, '_storeWorldTransform');

    // Toggle visibility off then back on, with no transform changes anywhere.
    root.visible = false;
    visit(root);
    root.visible = true;
    visit(root);

    expect(root.worldVisible).toBe(1);
    expect(child.worldVisible).toBe(1);

    // Matrix bytes unchanged …
    expect(Array.from(child.worldTransform.elements as Float32Array)).toEqual(Array.from(childWorldBefore));

    // … and the renderer was never told to re-upload it.
    expect(root._storeDirty).toBe(false);
    expect(child._storeDirty).toBe(false);
    expect(childStoreSpy).not.toHaveBeenCalled();
  });

  it("does NOT recompute a child's local matrix when only an ancestor's transform changed", () => {
    const root = new Container3D();
    const child = new Container3D();
    root.addChild(child);

    // Prime once so initial dirty state is consumed.
    visit(root);

    // Spy AFTER the first visit so we don't count the prime call.
    const childLocalSpy = vi.spyOn(child, 'updateLocalTransform');
    const rootLocalSpy = vi.spyOn(root, 'updateLocalTransform');
    const childStoreSpy = vi.spyOn(child, '_storeWorldTransform');

    // Move the parent. Child's local pos/rot/scale haven't changed.
    root.position.x = 5;
    visit(root);

    // Root's own transform changed — its local matrix must be rebuilt.
    expect(rootLocalSpy).toHaveBeenCalledTimes(1);

    // Child inherits a new world matrix (parent moved), but its LOCAL
    // matrix is unchanged, so updateLocalTransform must NOT be called.
    expect(childLocalSpy).not.toHaveBeenCalled();

    // But the child's world matrix DOES need to reflect the parent move, and
    // the pass publishes it right there — the sweep is never asked to.
    expect(child.worldTransform.elements[12]).toBe(5);
    expect(childStoreSpy).toHaveBeenCalledTimes(1);
    expect(child._storeDirty).toBe(false);
  });

  it('descendant whose own transform changed has both local AND world recomputed', () => {
    const root = new Container3D();
    const child = new Container3D();
    root.addChild(child);

    visit(root);

    const childLocalSpy = vi.spyOn(child, 'updateLocalTransform');

    child.position.x = 7;
    visit(root);

    expect(childLocalSpy).toHaveBeenCalledTimes(1);
    expect(child.worldTransform.elements[12]).toBe(7);
  });
});

describe('updateTransformAndChildren3D — hidden-state flag preservation', () => {
  it('preserves _localTransformDirty and _worldTransformDirty when work is skipped on a hidden subtree', () => {
    const root = new Container3D();
    const child = new Container3D();
    root.addChild(child);

    // Prime everything to a clean state.
    visit(root);
    expect(child._localTransformDirty).toBe(false);
    expect(child._worldTransformDirty).toBe(false);

    // Hide the subtree.
    root.visible = false;
    visit(root);
    expect(child.worldVisible).toBe(0);

    // Mutate child's local transform while hidden.
    child.position.x = 99;
    expect(child._localTransformDirty).toBe(true);
    expect(child._worldTransformDirty).toBe(true);

    // Visit while still hidden — work is skipped, but both signals must
    // survive so reshow can pick them up.
    visit(root);
    expect(child._localTransformDirty).toBe(true); // not consumed
    expect(child._worldTransformDirty).toBe(true); // preserved
    expect(child.worldTransform.elements[12]).not.toBe(99); // matrix untouched

    // Reshow — single visit picks up the staged work.
    root.visible = true;
    visit(root);
    expect(child._localTransformDirty).toBe(false); // consumed
    expect(child._worldTransformDirty).toBe(false); // cleared (visible path)
    expect(child.worldTransform.elements[12]).toBe(99); // applied
  });

  it('preserves cascaded _worldTransformDirty on a hidden descendant when an ancestor moves', () => {
    const root = new Container3D();
    const mid = new Container3D();
    const leaf = new Container3D();
    root.addChild(mid);
    mid.addChild(leaf);

    visit(root);

    // Hide the whole subtree at root.
    root.visible = false;
    visit(root);

    // Move `mid` while hidden — leaf's local is unchanged, but its world
    // matrix is invalidated by the ancestor move.
    mid.position.x = 12;
    visit(root);

    expect(leaf._localTransformDirty).toBe(false); // local unchanged
    expect(leaf._worldTransformDirty).toBe(true); // cascaded signal preserved

    // Reshow — leaf's world matrix should reflect mid's translation,
    // even though leaf's own local transform never changed.
    root.visible = true;
    visit(root);

    expect(leaf.worldTransform.elements[12]).toBe(12);
  });

  it('drops _worldVisibleDirty when hidden — only transform signal survives across visits', () => {
    const root = new Container3D();
    const child = new Container3D();
    root.addChild(child);

    visit(root);

    // Hide. visibleDirty drives this visit but should not survive
    // (visibility is already resolved as 0).
    root.visible = false;
    visit(root);

    expect(root._worldVisibleDirty).toBe(false);
    expect(child._worldVisibleDirty).toBe(false);
    expect(root._worldTransformDirty).toBe(false);
    expect(child._worldTransformDirty).toBe(false);
  });
});

describe('Mesh3D._storeWorldTransform — publishing the matrix from the transform pass', () => {
  const makeMesh = () =>
    new Mesh3D({ geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }), material: new FlatMaterial({}) });

  it('writes the world matrix straight into an allocated store row and marks it for upload', () => {
    const view = new View3D({ width: 64, height: 64 });
    const mesh = makeMesh();
    view.root.addChild(mesh);

    // The scene sweep mints the row on first sight; stand in for it.
    const store = view._sceneBatch.storeBuffer;
    const index = store.set(mesh);
    updateView3DTransforms(view);
    store.update();
    mesh._storeDirty = false;

    mesh.position.set(3, 4, 5);
    updateView3DTransforms(view);

    const row = store.data.subarray(index * MESH3D_STORE_STRIDE, (index + 1) * MESH3D_STORE_STRIDE);
    expect(Array.from(row.subarray(12, 15))).toEqual([3, 4, 5]);
    // Published, not flagged: nothing is left for the sweep to re-emit …
    expect(mesh._storeDirty).toBe(false);
    // … but the row is queued for upload.
    expect(store['_minDirty']).toBe(index);
    expect(store['_maxDirty']).toBe(index);

    view.destroy();
  });

  it('defers to the sweep while the mesh has no row yet', () => {
    const view = new View3D({ width: 64, height: 64 });
    const mesh = makeMesh();
    view.root.addChild(mesh);
    mesh._storeDirty = false;

    expect(mesh._storeIndex).toBe(-1);
    updateView3DTransforms(view);

    expect(mesh._storeDirty).toBe(true);

    view.destroy();
  });

  it('never writes through a row it held in a View that has since been destroyed', () => {
    const viewA = new View3D({ width: 64, height: 64 });
    const survivor = makeMesh();
    viewA.root.addChild(survivor);
    const oldIndex = viewA._sceneBatch.storeBuffer.set(survivor);
    expect(oldIndex).toBeGreaterThanOrEqual(0);

    // Destroying the View keeps its meshes but detaches them: the row goes with the store.
    viewA.destroy();
    expect(survivor._storeIndex).toBe(-1);
    expect(survivor.view3d).toBeNull();

    // A second View whose store hands the same index to a mesh of its own.
    const viewB = new View3D({ width: 64, height: 64 });
    const storeB = viewB._sceneBatch.storeBuffer;
    const resident = makeMesh();
    resident.position.set(1, 2, 3);
    viewB.root.addChild(resident);
    updateView3DTransforms(viewB);
    const residentIndex = storeB.set(resident);
    expect(residentIndex).toBe(oldIndex);

    viewB.root.addChild(survivor);
    survivor.position.set(7, 8, 9);
    survivor._storeDirty = false;
    updateView3DTransforms(viewB);

    // The resident's row is untouched; the survivor waits for the sweep to mint it a row.
    const residentRow = storeB.data.subarray(
      residentIndex * MESH3D_STORE_STRIDE,
      (residentIndex + 1) * MESH3D_STORE_STRIDE,
    );
    expect(Array.from(residentRow.subarray(12, 15))).toEqual([1, 2, 3]);
    expect(survivor._storeIndex).toBe(-1);
    expect(survivor._storeDirty).toBe(true);

    // The sweep's full-row `set` mints a fresh row carrying the survivor's matrix …
    const newIndex = storeB.set(survivor);
    expect(newIndex).not.toBe(residentIndex);
    const survivorRow = storeB.data.subarray(newIndex * MESH3D_STORE_STRIDE, (newIndex + 1) * MESH3D_STORE_STRIDE);
    expect(Array.from(survivorRow.subarray(12, 15))).toEqual([7, 8, 9]);

    // … and from then on the pass publishes moves straight into that row.
    survivor.position.set(4, 5, 6);
    updateView3DTransforms(viewB);
    expect(Array.from(survivorRow.subarray(12, 15))).toEqual([4, 5, 6]);
    expect(Array.from(residentRow.subarray(12, 15))).toEqual([1, 2, 3]);

    viewB.destroy();
  });
});
