import { describe, expect, it } from 'vitest';

import type { AlphaMode } from '~/materials/BaseMaterial3D';

import { textureSetId } from '../textureSetId';
import { updateMesh3DKeys } from '../updateMesh3DKeys';

const OVERFLOWING_TEXTURE_COUNTS = [16, 17, 40];

function geometry(uid: number, atlasUid?: number) {
  return { uid, _geometryAtlasAllocation: atlasUid === undefined ? null : { atlas: { uid: atlasUid } } };
}

type FakeGeometry = ReturnType<typeof geometry>;

function material(uid: number, sourceUids: number[], alphaMode: AlphaMode = 'opaque') {
  const _textures = sourceUids.map((sourceUid) => ({ source: { uid: sourceUid } }));

  return { uid, _textures, _textureSetId: textureSetId(_textures), alphaMode };
}

function renderable(geom: FakeGeometry, textureCount = 1, alphaMode: AlphaMode = 'opaque', materialUid = 0) {
  return {
    _sortKey: 0,
    geometry: geom,
    material: material(
      materialUid,
      Array.from({ length: textureCount }, () => 1),
      alphaMode,
    ),
  };
}

function batchKeyFor(pipelineKey: number, geom: FakeGeometry): number {
  const cache = { batchKey: 0 };
  updateMesh3DKeys(renderable(geom), cache, pipelineKey);

  return cache.batchKey;
}

function sortKeyFor(
  pipelineKey: number,
  geom: FakeGeometry,
  textureCount = 1,
  materialUid = 0,
  alphaMode: AlphaMode = 'opaque',
): number {
  const item = renderable(geom, textureCount, alphaMode, materialUid);
  updateMesh3DKeys(item, { batchKey: 0 }, pipelineKey);

  return item._sortKey;
}

describe('updateMesh3DKeys batch key', () => {
  it('keeps geometries apart whose uids collide in a 12- or 16-bit field', () => {
    const base = 1000;
    const uids = [base, base + 0x1000, base + 0x2000, base + 0x10000];

    const atlased = uids.map((uid) => batchKeyFor(7, geometry(uid, 3)));
    const standalone = uids.map((uid) => batchKeyFor(7, geometry(uid)));

    expect(new Set(atlased).size).toBe(uids.length);
    expect(new Set(standalone).size).toBe(uids.length);
  });

  it("keeps pipelines apart, including wide keys like WebGPU's that differ only above bit 32", () => {
    const geom = geometry(42, 1);
    const wide = 2 ** 45;
    const pipelineKeys = [1, 2, 0x7fff_ffff, 0x8000_0000, wide + 1, wide + 2, wide * 2 + 1, wide * 2 + 2];

    const keys = pipelineKeys.map((pipelineKey) => batchKeyFor(pipelineKey, geom));

    expect(new Set(keys).size).toBe(pipelineKeys.length);
  });
});

describe('updateMesh3DKeys sort key', () => {
  it('orders by texture layout, then pipeline, then texture set, then geometry, then material, each field outranking all below it', () => {
    const pipeLow = 900_001;
    const pipeHigh = 900_002;
    const geomLow = geometry(10);
    const geomHigh = geometry(20);

    expect(sortKeyFor(pipeLow, geomLow), 'pipeLow is seen first, so it gets the lower counted id').toBeLessThan(
      sortKeyFor(pipeHigh, geomLow),
    );

    expect(sortKeyFor(pipeLow, geomHigh, 1, 0)).toBeLessThan(sortKeyFor(pipeHigh, geomLow, 1, 0));
    expect(sortKeyFor(pipeLow, geomLow, 1, 0xffff)).toBeLessThan(sortKeyFor(pipeLow, geomHigh, 1, 0));
    expect(sortKeyFor(pipeHigh, geomHigh, 1, 0xffff)).toBeLessThan(sortKeyFor(pipeLow, geomLow, 2, 0));

    expect(Number.isSafeInteger(sortKeyFor(pipeHigh, geomHigh, 4, 0xffff))).toBe(true);
  });

  it('puts the pipeline above the texture set, so a set drawn by two pipelines sorts by pipeline first', () => {
    const geom = geometry(5);
    const key = (pipelineKey: number, sourceUid: number) => {
      const item = { _sortKey: 0, geometry: geom, material: material(0, [sourceUid]) };
      const cache = { batchKey: 0 };
      updateMesh3DKeys(item, cache, pipelineKey);

      return { sortKey: item._sortKey, pipelineId: Math.floor(cache.batchKey / 0x1_0000_0000) };
    };
    let pipeLow = 930_001;
    while ((key(pipeLow, 939).pipelineId & 0xff) === 0xff) pipeLow += 2;
    const pipeHigh = pipeLow + 1;

    const lowPipeEarlySet = key(pipeLow, 940).sortKey;
    const lowPipeLateSet = key(pipeLow, 941).sortKey;
    const highPipeEarlySet = key(pipeHigh, 940).sortKey;

    expect(lowPipeEarlySet, 'the set seen first gets the lower counted id').toBeLessThan(lowPipeLateSet);
    expect(lowPipeLateSet, 'a later set on the lower pipeline still sorts first').toBeLessThan(highPipeEarlySet);
  });

  it('groups atlased geometry by its atlas ahead of the geometry uid', () => {
    const pipelineKey = 910_001;

    expect(sortKeyFor(pipelineKey, geometry(5, 1))).toBeLessThan(sortKeyFor(pipelineKey, geometry(4, 2)));
  });

  it('puts the texture set above geometry, so meshes sampling the same sources sort together across geometries', () => {
    const pipelineKey = 3;
    const sharedSources = [10, 11];
    const otherSources = [12, 11];
    const key = (geom: FakeGeometry, sourceUids: number[], uid: number) => {
      const item = { _sortKey: 0, geometry: geom, material: material(uid, sourceUids) };
      updateMesh3DKeys(item, { batchKey: 0 }, pipelineKey);

      return item._sortKey;
    };
    const a = key(geometry(1), sharedSources, 1);
    const b = key(geometry(2), sharedSources, 2);
    const c = key(geometry(1), otherSources, 3);

    expect(Math.abs(a - b), 'same set, different geometry: differ below the texture-set field').toBeLessThan(2 ** 24);
    expect(Math.abs(a - c), 'different set, same geometry: differ at or above it').toBeGreaterThanOrEqual(2 ** 24);
    expect(key(geometry(1), [11, 10], 4), 'slot order is part of the set').not.toBe(a);
  });

  it('gives every distinct texture set its own field value, whatever the map count or the uid spacing', () => {
    const pipelineKey = 3;
    const materialCount = 1024;
    const textureSetField = (sortKey: number) => Math.floor(sortKey / 2 ** 24) & 0xffff;
    const fieldsFor = (mapCount: number) => {
      const fields = new Set<number>();
      for (let i = 0; i < materialCount; i++) {
        const item = {
          _sortKey: 0,
          geometry: geometry(1),
          material: material(
            i,
            Array.from({ length: mapCount }, (_, t) => 10 + mapCount * i + t),
          ),
        };
        updateMesh3DKeys(item, { batchKey: 0 }, pipelineKey);
        fields.add(textureSetField(item._sortKey));
      }

      return fields;
    };

    for (const mapCount of [1, 2, 3, 4]) {
      expect(fieldsFor(mapCount).size, `${mapCount} maps: counted ids never collide below 65536 sets`).toBe(
        materialCount,
      );
    }
  });

  it('keeps only the low 12 bits of the material uid, so a uid past 4095 still sorts within its geometry', () => {
    const pipelineKey = 920_001;
    const geom = geometry(5);

    expect(sortKeyFor(pipelineKey, geom, 1, 0x1_0007)).toBe(sortKeyFor(pipelineKey, geom, 1, 7));
    expect(sortKeyFor(pipelineKey, geom, 1, 7)).toBeLessThan(sortKeyFor(pipelineKey, geom, 1, 8));
    expect(sortKeyFor(pipelineKey, geom, 1, 0xffff)).toBeLessThan(sortKeyFor(pipelineKey, geometry(6), 1, 0));
  });
});

describe('updateMesh3DKeys cutout ordering', () => {
  it('keeps a material out of the cutout group when it has more textures than the layout field holds', () => {
    const geom = geometry(5);
    const cutout = sortKeyFor(1, geom, 1, 0, 'mask');

    for (const textureCount of OVERFLOWING_TEXTURE_COUNTS) {
      const opaque = sortKeyFor(0xffff, geom, textureCount, 0xffff);

      expect(opaque, `${textureCount} textures`).toBeLessThan(cutout);
      expect(Number.isSafeInteger(opaque)).toBe(true);
    }

    const bigCutout = sortKeyFor(0xffff, geom, 40, 0xffff, 'mask');
    expect(bigCutout).toBeGreaterThan(cutout);
    expect(Number.isSafeInteger(bigCutout)).toBe(true);
  });

  it('keeps the pipeline grouping within the cutout group', () => {
    const geom = geometry(5);
    const a = sortKeyFor(1, geom, 1, 0, 'mask');
    const b = sortKeyFor(2, geom, 1, 0, 'mask');

    expect(b - a).toBe(sortKeyFor(2, geom) - sortKeyFor(1, geom));
  });
});
