import { describe, expect, it } from 'vitest';

import type { DataStoreBuffer } from '~/core/buffers/DataStoreBuffer';
import { GeometryDataStoreBuffer } from '~/core/buffers/GeometryDataStoreBuffer';
import { MaterialDataStoreBuffer } from '~/core/buffers/MaterialDataStoreBuffer';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';

/** Rows the store has handed out and not taken back */
const liveRows = (store: DataStoreBuffer): number => {
  const probe = store as unknown as { _count: number; _freeCount: number };

  return probe._count - probe._freeCount;
};

// Materials and geometries are user-owned; the store that minted their row is
// the one they carry. When another store sees them it re-mints, and the row on
// the store they came from goes back before the new one is minted: the object
// that joined a store is what unwires it, whether that store is dead or alive.
describe('store re-mint hands the old row back', () => {
  it('a material registered by a second store frees its row on the first', () => {
    const storeA = new MaterialDataStoreBuffer();
    const storeB = new MaterialDataStoreBuffer();
    const material = new Material3D({ baseColor: 0x8899aa });

    storeA.register(material);
    storeA.update();
    expect(material._uploadQueue).toBe(storeA);
    expect(liveRows(storeA)).toBe(1);

    storeB.register(material);
    expect(material._uploadQueue).toBe(storeB);
    expect(liveRows(storeA)).toBe(0);
    expect(liveRows(storeB)).toBe(1);
    expect(material._materialIndex).toBeGreaterThanOrEqual(0);

    storeA.destroy();
    storeB.destroy();
  });

  it('a store draining a material re-minted elsewhere mints it no row', () => {
    const storeA = new MaterialDataStoreBuffer();
    const storeB = new MaterialDataStoreBuffer();
    const material = new Material3D({ baseColor: 0x8899aa });

    storeA.register(material); // queued on A, not yet drained
    storeB.register(material); // re-minted on B before A's drain
    expect(liveRows(storeA)).toBe(0);

    storeA.update();
    expect(liveRows(storeA)).toBe(0);
    expect(material._uploadQueue).toBe(storeB);
    expect(liveRows(storeB)).toBe(1);

    // A's drain leaves B's queue state alone: the entry is still B's to drain.
    expect(material._storeQueued).toBe(true);
    storeB.update();
    expect(material._storeQueued).toBe(false);

    storeA.destroy();
    storeB.destroy();
  });

  it('a geometry set by a second store frees its row on the first', () => {
    const storeA = new GeometryDataStoreBuffer();
    const storeB = new GeometryDataStoreBuffer();
    const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });

    storeA.set(geometry);
    expect(geometry._geometryDataStore).toBe(storeA);
    expect(liveRows(storeA)).toBe(1);

    storeB.set(geometry);
    expect(geometry._geometryDataStore).toBe(storeB);
    expect(liveRows(storeA)).toBe(0);
    expect(liveRows(storeB)).toBe(1);
    expect(geometry._geometryDataIndex).toBeGreaterThanOrEqual(0);

    storeA.destroy();
    storeB.destroy();
  });
});
