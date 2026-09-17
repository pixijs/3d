import { describe, expect, it } from 'vitest';

import { GEOMETRY_DATA_STRIDE, GeometryDataStoreBuffer } from '~/core/buffers/GeometryDataStoreBuffer';
import { Geometry3D } from '~/geometry/Geometry3D';

const triangle = (): Geometry3D =>
  new Geometry3D({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  });

describe('Geometry3D.destroy', () => {
  it('is idempotent — a second destroy is a no-op and does not throw', () => {
    const geometry = new Geometry3D({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    });

    expect(() => geometry.destroy(true)).not.toThrow();

    // pixi's Geometry.destroy nulls `buffers`; without the idempotency guard a
    // second pass would throw on `buffers.forEach`. This is what makes geometry
    // shared across meshes / batches safe to tear down through multiple owners.
    expect(() => geometry.destroy(true)).not.toThrow();
  });

  it('releases its data-store slot on destroy so churned geometries recycle rows', () => {
    const store = new GeometryDataStoreBuffer();
    const geometry = triangle();

    store.set(geometry);
    const slot = geometry._geometryDataIndex;
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(geometry._geometryDataStore).toBe(store);

    geometry.destroy(true);
    expect(geometry._geometryDataIndex).toBe(-1);

    // The freed row is recycled, not appended past — create/destroy churn must
    // not grow the store for the renderer's lifetime.
    const next = triangle();
    store.set(next);
    expect(next._geometryDataIndex).toBe(slot);

    next.destroy(true);
    store.destroy();
  });

  it('destroy after the store is torn down is safe and still resets the index', () => {
    const store = new GeometryDataStoreBuffer();
    const geometry = triangle();

    store.set(geometry);
    store.destroy();

    expect(() => geometry.destroy(true)).not.toThrow();
    expect(geometry._geometryDataIndex).toBe(-1); // free to re-mint in a fresh renderer's store
  });

  // The store is renderer-scoped; geometries are user-owned and outlive it. A
  // survivor keeps the dead store's row until the next renderer's store sees
  // it, and set() re-mints there instead of adopting the stale row.
  it('a geometry minted by a destroyed store re-mints lazily in a fresh store', () => {
    const storeA = new GeometryDataStoreBuffer();
    const survivor = triangle();
    storeA.set(survivor);
    storeA.destroy();

    const storeB = new GeometryDataStoreBuffer();
    const resident = triangle();
    storeB.set(resident); // takes the row number the survivor still carries
    storeB.set(survivor);
    expect(survivor._geometryDataStore).toBe(storeB);
    expect(survivor._geometryDataIndex).not.toBe(resident._geometryDataIndex);

    survivor.destroy(true);
    resident.destroy(true);
    storeB.destroy();
  });

  it('a geometry moving between two live stores re-mints instead of adopting the foreign slot', () => {
    const storeA = new GeometryDataStoreBuffer();
    const storeB = new GeometryDataStoreBuffer();
    const geometry = triangle();
    const resident = triangle();

    storeA.set(geometry); // minted in A: slot 0
    storeB.set(resident); // B's slot 0 belongs to someone else
    storeB.set(geometry);
    expect(geometry._geometryDataStore).toBe(storeB);
    expect(geometry._geometryDataIndex).toBe(1); // B minted its own row — A's slot 0 was never adopted

    // Destroy frees B's row (the back-ref store), never poisoning it with A's index.
    geometry.destroy(true);
    const next = triangle();
    storeB.set(next);
    expect(next._geometryDataIndex).toBe(1); // recycled from the freed B row, not colliding with the resident

    next.destroy(true);
    resident.destroy(true);
    storeA.destroy();
    storeB.destroy();
  });

  it('writes a dead morph texel for a morphed survivor that can no longer pack', () => {
    const store = new GeometryDataStoreBuffer();
    const geometry = triangle();
    // A morphed survivor of a destroyed renderer: the count survives, the packed base does not.
    (geometry as { morphTargetCount: number }).morphTargetCount = 2;

    store.set(geometry);

    const lanes = geometry._geometryDataIndex * GEOMETRY_DATA_STRIDE;
    expect(store.u32Data[lanes + 5]).toBe(0); // zero count — the morph loop is dead, no wrapped offset read

    geometry.destroy(true);
    store.destroy();
  });
});
