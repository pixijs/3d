import { RendererType } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { DataStoreBuffer } from '~/core/buffers/DataStoreBuffer';
import { GeometryDataStoreBuffer } from '~/core/buffers/GeometryDataStoreBuffer';
import { MaterialDataStoreBuffer } from '~/core/buffers/MaterialDataStoreBuffer';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';

const liveRows = <T extends object>(store: DataStoreBuffer<T>): number => {
  const probe = store as unknown as { _count: number; _freeCount: number };

  return probe._count - probe._freeCount;
};

const ALIGNMENT = 256;

const liveUnits = (store: MaterialDataStoreBuffer): number => {
  const probe = store as unknown as { _end: number; _freePlaces: Map<number, number[]> };
  let freed = 0;
  for (const [length, places] of probe._freePlaces) freed += length * places.length;

  return probe._end - freed;
};

const units = (material: Material3D): number => Math.ceil(material.data._f32.byteLength / ALIGNMENT);

describe('store re-mint hands the old row back', () => {
  it('a material registered by a second store frees its place on the first', () => {
    const storeA = new MaterialDataStoreBuffer({ alignment: ALIGNMENT, rendererType: RendererType.WEBGPU });
    const storeB = new MaterialDataStoreBuffer({ alignment: ALIGNMENT, rendererType: RendererType.WEBGPU });
    const material = new Material3D({ baseColor: 0x8899aa });

    storeA.register(material);
    storeA.update();
    expect(material._uploadQueue).toBe(storeA);
    expect(liveUnits(storeA)).toBe(units(material));

    storeB.register(material);
    expect(material._uploadQueue).toBe(storeB);
    expect(liveUnits(storeA)).toBe(0);
    expect(liveUnits(storeB)).toBe(units(material));
    expect(material._materialIndex).toBeGreaterThanOrEqual(0);

    storeA.destroy();
    storeB.destroy();
  });

  it('a store draining a material re-minted elsewhere mints it no place', () => {
    const storeA = new MaterialDataStoreBuffer({ alignment: ALIGNMENT, rendererType: RendererType.WEBGPU });
    const storeB = new MaterialDataStoreBuffer({ alignment: ALIGNMENT, rendererType: RendererType.WEBGPU });
    const material = new Material3D({ baseColor: 0x8899aa });

    storeA.register(material);
    storeB.register(material);
    expect(liveUnits(storeA), "registered on B before A's drain").toBe(0);

    storeA.update();
    expect(liveUnits(storeA)).toBe(0);
    expect(material._uploadQueue).toBe(storeB);
    expect(liveUnits(storeB)).toBe(units(material));

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
