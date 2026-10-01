import { describe, expect, it, vi } from 'vitest';

import { MESH3D_STORE_STRIDE } from '~/core/buffers/Mesh3DDataStoreBuffer';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { updateTransformAndChildren3D, updateView3DTransforms } from '~/scene/utils/updateView3DTransforms';
import { View3D } from '~/scene/View3D';

/** Root parent for `visit`, matching the pass's private `TEMP_PARENT_3D`: identity worldTransform, worldVisible 1 */
const tempParent = new Container3D();

let tickCounter = 0;
const nextTick = () => ++tickCounter;

const visit = (root: Container3D) => {
  updateTransformAndChildren3D(root, tempParent, nextTick(), false, false);
};

describe('updateTransformAndChildren3D — visibility propagation', () => {
  it('child inherits invisible from any ancestor regardless of own visible flag', () => {
    const root = new Container3D();
    const mid = new Container3D();
    const leaf = new Container3D();

    root.addChild(mid);
    mid.addChild(leaf);

    root.visible = false;
    leaf.visible = true;

    visit(root);

    expect(root.worldVisible).toBe(0);
    expect(mid.worldVisible).toBe(0);
    expect(leaf.worldVisible).toBe(0);
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

describe('updateTransformAndChildren3D — work-skipping by flag', () => {
  it('visibility-only flip does NOT recompute world matrix or set _storeDirty', () => {
    const root = new Container3D();
    const child = new Container3D();
    root.addChild(child);

    visit(root);
    root._storeDirty = false;
    child._storeDirty = false;

    const childWorldBefore = new Float32Array(child.worldTransform.elements as Float32Array);
    const childStoreSpy = vi.spyOn(child, '_storeWorldTransform');

    root.visible = false;
    visit(root);
    root.visible = true;
    visit(root);

    expect(root.worldVisible).toBe(1);
    expect(child.worldVisible).toBe(1);

    expect(Array.from(child.worldTransform.elements as Float32Array)).toEqual(Array.from(childWorldBefore));
    expect(root._storeDirty).toBe(false);
    expect(child._storeDirty).toBe(false);
    expect(childStoreSpy).not.toHaveBeenCalled();
  });

  it("rebuilds and publishes a child's world matrix, but not its local one, when only an ancestor moved", () => {
    const root = new Container3D();
    const child = new Container3D();
    root.addChild(child);

    visit(root);

    const childLocalSpy = vi.spyOn(child, 'updateLocalTransform');
    const rootLocalSpy = vi.spyOn(root, 'updateLocalTransform');
    const childStoreSpy = vi.spyOn(child, '_storeWorldTransform');

    root.position.x = 5;
    visit(root);

    expect(rootLocalSpy).toHaveBeenCalledTimes(1);
    expect(childLocalSpy).not.toHaveBeenCalled();
    expect(child.worldTransform.elements[12]).toBe(5);
    expect(childStoreSpy).toHaveBeenCalledTimes(1);
    expect(child._storeDirty).toBe(false);
  });
});

describe('updateTransformAndChildren3D — hidden-state flag preservation', () => {
  it('keeps both transform dirty flags on a hidden subtree, and one visit after reshowing applies them', () => {
    const root = new Container3D();
    const child = new Container3D();
    root.addChild(child);

    visit(root);
    expect(child._localTransformDirty).toBe(false);
    expect(child._worldTransformDirty).toBe(false);

    root.visible = false;
    visit(root);
    expect(child.worldVisible).toBe(0);

    child.position.x = 99;
    expect(child._localTransformDirty).toBe(true);
    expect(child._worldTransformDirty).toBe(true);

    visit(root);
    expect(child._localTransformDirty).toBe(true);
    expect(child._worldTransformDirty).toBe(true);
    expect(child.worldTransform.elements[12]).not.toBe(99);

    root.visible = true;
    visit(root);
    expect(child._localTransformDirty).toBe(false);
    expect(child._worldTransformDirty).toBe(false);
    expect(child.worldTransform.elements[12]).toBe(99);
  });

  it("keeps a hidden leaf's cascaded _worldTransformDirty when an ancestor moves, so reshowing applies it", () => {
    const root = new Container3D();
    const mid = new Container3D();
    const leaf = new Container3D();
    root.addChild(mid);
    mid.addChild(leaf);

    visit(root);

    root.visible = false;
    visit(root);

    mid.position.x = 12;
    visit(root);

    expect(leaf._localTransformDirty).toBe(false);
    expect(leaf._worldTransformDirty).toBe(true);

    root.visible = true;
    visit(root);

    expect(leaf.worldTransform.elements[12]).toBe(12);
  });

  it('clears _worldVisibleDirty on the visit that hides a subtree, since that visit resolves worldVisible to 0', () => {
    const root = new Container3D();
    const child = new Container3D();
    root.addChild(child);

    visit(root);

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

  it('writes the world matrix straight into an allocated store row and queues it for upload', () => {
    const view = new View3D({ width: 64, height: 64 });
    const mesh = makeMesh();
    view.root.addChild(mesh);

    const store = view._sceneBatch.storeBuffer;
    /** The mesh's store row, minted here as the scene sweep would on first sight */
    const index = store.set(mesh);
    updateView3DTransforms(view);
    store.update();
    mesh._storeDirty = false;

    mesh.position.set(3, 4, 5);
    updateView3DTransforms(view);

    const row = store.data.subarray(index * MESH3D_STORE_STRIDE, (index + 1) * MESH3D_STORE_STRIDE);
    expect(Array.from(row.subarray(12, 15))).toEqual([3, 4, 5]);
    expect(mesh._storeDirty, 'published, so the sweep has nothing left to re-emit').toBe(false);
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

  it('never writes through a row it held in a destroyed View, and publishes into the row its new View mints', () => {
    const viewA = new View3D({ width: 64, height: 64 });
    const survivor = makeMesh();
    viewA.root.addChild(survivor);
    const oldIndex = viewA._sceneBatch.storeBuffer.set(survivor);
    expect(oldIndex).toBeGreaterThanOrEqual(0);

    viewA.destroy();
    expect(survivor._storeIndex).toBe(-1);
    expect(survivor.view3d).toBeNull();

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

    const residentRow = storeB.data.subarray(
      residentIndex * MESH3D_STORE_STRIDE,
      (residentIndex + 1) * MESH3D_STORE_STRIDE,
    );
    expect(Array.from(residentRow.subarray(12, 15))).toEqual([1, 2, 3]);
    expect(survivor._storeIndex).toBe(-1);
    expect(survivor._storeDirty).toBe(true);

    /** A fresh row for the survivor, minted as the sweep's full-row `set` would, carrying its matrix */
    const newIndex = storeB.set(survivor);
    expect(newIndex).not.toBe(residentIndex);
    const survivorRow = storeB.data.subarray(newIndex * MESH3D_STORE_STRIDE, (newIndex + 1) * MESH3D_STORE_STRIDE);
    expect(Array.from(survivorRow.subarray(12, 15))).toEqual([7, 8, 9]);

    survivor.position.set(4, 5, 6);
    updateView3DTransforms(viewB);
    expect(Array.from(survivorRow.subarray(12, 15))).toEqual([4, 5, 6]);
    expect(Array.from(residentRow.subarray(12, 15))).toEqual([1, 2, 3]);

    viewB.destroy();
  });
});
