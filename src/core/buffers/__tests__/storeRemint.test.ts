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

    storeA.register(material);
    storeB.register(material);
    expect(liveRows(storeA), "registered on B before A's drain").toBe(0);

    storeA.update();
    expect(liveRows(storeA)).toBe(0);
    expect(material._uploadQueue).toBe(storeB);
    expect(liveRows(storeB)).toBe(1);

    expect(material._storeQueued, "A's drain leaves the entry for B to drain").toBe(true);
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
