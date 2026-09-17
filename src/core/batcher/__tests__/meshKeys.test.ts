import { describe, expect, it } from 'vitest';

import { updateMesh3DKeys } from '../updateMesh3DKeys';

// The batcher starts a new draw command the moment `batchKey` changes, so two meshes
// sharing a key render with the first one's shader, state and index range. These tests
// pin the split: `batchKey` carries pipeline and geometry identity exactly, while
// `_sortKey` is free to be lossy because it only decides draw order.

/** `updateMesh3DKeys` reads only the uid and the atlas allocation off a geometry. */
function geometry(uid: number, atlasUid?: number) {
  return { uid, _geometryAtlasAllocation: atlasUid === undefined ? null : { atlas: { uid: atlasUid } } };
}

type FakeGeometry = ReturnType<typeof geometry>;

function renderable(geom: FakeGeometry, textureCount = 1, textureCacheKey = 0) {
  return {
    _sortKey: 0,
    geometry: geom,
    material: { textureCacheKey, _textures: { length: textureCount } },
  };
}

function batchKeyFor(pipelineKey: number, geom: FakeGeometry): number {
  const cache = { batchKey: 0 };
  updateMesh3DKeys(renderable(geom), cache, pipelineKey);

  return cache.batchKey;
}

function sortKeyFor(pipelineKey: number, geom: FakeGeometry, textureCount = 1, textureCacheKey = 0): number {
  const item = renderable(geom, textureCount, textureCacheKey);
  updateMesh3DKeys(item, { batchKey: 0 }, pipelineKey);

  return item._sortKey;
}

describe('updateMesh3DKeys batch key', () => {
  it('keeps geometries apart whose uids collide once truncated', () => {
    const base = 1000;
    // 0x1000 and 0x10000 apart are the wrap distances a 12- or 16-bit geometry field folds together.
    const uids = [base, base + 0x1000, base + 0x2000, base + 0x10000];

    const atlased = uids.map((uid) => batchKeyFor(7, geometry(uid, 3)));
    const standalone = uids.map((uid) => batchKeyFor(7, geometry(uid)));

    expect(new Set(atlased).size).toBe(uids.length);
    expect(new Set(standalone).size).toBe(uids.length);
  });

  it('keeps pipelines apart, including wide keys differing only above bit 32', () => {
    const geom = geometry(42, 1);
    // WebGPU's graphics-state key runs past bit 45, so the high half has to survive.
    const wide = 2 ** 45;
    const pipelineKeys = [1, 2, 0x7fff_ffff, 0x8000_0000, wide + 1, wide + 2, wide * 2 + 1, wide * 2 + 2];

    const keys = pipelineKeys.map((pipelineKey) => batchKeyFor(pipelineKey, geom));

    expect(new Set(keys).size).toBe(pipelineKeys.length);
  });

  it('is stable for an unchanged pair and stays an exact integer', () => {
    const geom = geometry(123_456, 2);
    const first = batchKeyFor(2 ** 44 + 9, geom);
    const second = batchKeyFor(2 ** 44 + 9, geom);

    expect(second).toBe(first);
    expect(Number.isSafeInteger(first)).toBe(true);
  });

  it('separates the same geometry across different pipelines', () => {
    const geom = geometry(77, 1);

    expect(batchKeyFor(500, geom)).not.toBe(batchKeyFor(501, geom));
  });
});

describe('updateMesh3DKeys sort key', () => {
  it('orders by texture layout, then pipeline, then geometry, then texture', () => {
    // Ids are counted up in first-seen order, so `pipeLow` gets the lower one.
    const pipeLow = 900_001;
    const pipeHigh = 900_002;
    const geomLow = geometry(10);
    const geomHigh = geometry(20);

    expect(sortKeyFor(pipeLow, geomLow)).toBeLessThan(sortKeyFor(pipeHigh, geomLow));

    // Each field outranks everything below it, even at the bottom of its range.
    expect(sortKeyFor(pipeLow, geomHigh, 1, 0)).toBeLessThan(sortKeyFor(pipeHigh, geomLow, 1, 0));
    expect(sortKeyFor(pipeLow, geomLow, 1, 0xffff)).toBeLessThan(sortKeyFor(pipeLow, geomHigh, 1, 0));
    expect(sortKeyFor(pipeHigh, geomHigh, 1, 0xffff)).toBeLessThan(sortKeyFor(pipeLow, geomLow, 2, 0));

    expect(Number.isSafeInteger(sortKeyFor(pipeHigh, geomHigh, 4, 0xffff))).toBe(true);
  });

  it('groups atlased geometry by its atlas', () => {
    const pipelineKey = 910_001;

    // Atlas wins over the geometry uid, so draws sharing the merged buffers stay contiguous.
    expect(sortKeyFor(pipelineKey, geometry(5, 1))).toBeLessThan(sortKeyFor(pipelineKey, geometry(4, 2)));
  });
});
