import { describe, expect, it } from 'vitest';

import { GEOMETRY_DATA_STRIDE, GeometryDataStoreBuffer } from '~/core/buffers/GeometryDataStoreBuffer';
import { Geometry3D } from '~/geometry/Geometry3D';

const MORPH_COUNT_LANE = 5;

const triangle = (): Geometry3D =>
  new Geometry3D({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  });

describe('Geometry3D.destroy', () => {
  it('is idempotent, so each owner of a shared geometry can destroy it', () => {
    const geometry = new Geometry3D({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    });

    expect(() => geometry.destroy(true)).not.toThrow();
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

    const next = triangle();
    store.set(next);
    expect(next._geometryDataIndex).toBe(slot);

    next.destroy(true);
    store.destroy();
  });

  it('destroy after the store is torn down is safe and still resets the index for a fresh store to re-mint', () => {
    const store = new GeometryDataStoreBuffer();
    const geometry = triangle();

    store.set(geometry);
    store.destroy();

    expect(() => geometry.destroy(true)).not.toThrow();
    expect(geometry._geometryDataIndex).toBe(-1);
  });

  it('a geometry minted by a destroyed store re-mints lazily in a fresh store instead of adopting its stale row', () => {
    const storeA = new GeometryDataStoreBuffer();
    const survivor = triangle();
    storeA.set(survivor);
    storeA.destroy();

    const storeB = new GeometryDataStoreBuffer();
    const resident = triangle();
    storeB.set(resident);
    storeB.set(survivor);
    expect(survivor._geometryDataStore).toBe(storeB);
    expect(survivor._geometryDataIndex).not.toBe(resident._geometryDataIndex);

    survivor.destroy(true);
    resident.destroy(true);
    storeB.destroy();
  });

  it('writes a zero morph count for a morphed geometry with no packed deltas, such as a survivor of a destroyed renderer', () => {
    const store = new GeometryDataStoreBuffer();
    const geometry = triangle();
    (geometry as { morphTargetCount: number }).morphTargetCount = 2;

    store.set(geometry);

    const lanes = geometry._geometryDataIndex * GEOMETRY_DATA_STRIDE;
    expect(store.u32Data[lanes + MORPH_COUNT_LANE]).toBe(0);

    geometry.destroy(true);
    store.destroy();
  });
});
