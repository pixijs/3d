import { describe, expect, it } from 'vitest';

import type { AlphaMode } from '~/materials/BaseMaterial3D';

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

function renderable(geom: FakeGeometry, textureCount = 1, textureCacheKey = 0, alphaMode: AlphaMode = 'opaque') {
  return {
    _sortKey: 0,
    geometry: geom,
    material: { textureCacheKey, _textures: { length: textureCount }, alphaMode },
  };
}

function batchKeyFor(pipelineKey: number, geom: FakeGeometry): number {
  const cache = { batchKey: 0 };
  updateMesh3DKeys(renderable(geom), cache, pipelineKey);

  return cache.batchKey;
}

function sortKeyFor(pipelineKey: number, ...args: Parameters<typeof renderable>): number {
  const item = renderable(...args);
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

describe('updateMesh3DKeys cutout ordering', () => {
  it('sorts alpha-masked meshes after every opaque one, whatever their layout or pipeline', () => {
    const geom = geometry(5);
    // The opaque mesh takes the largest values for the two fields a call sets directly: the
    // texture count the layout field holds, and the texture cache key. The pipeline argument is
    // a key mapped to a small counted id, so that field is nowhere near its own maximum here.
    const opaque = sortKeyFor(0xffff, geom, 15, 0xffff);
    const cutout = sortKeyFor(1, geom, 1, 0, 'mask');

    expect(cutout).toBeGreaterThan(opaque);
  });

  it('keeps a material out of the cutout group when it has more textures than the layout field holds', () => {
    const geom = geometry(5);
    const cutout = sortKeyFor(1, geom, 1, 0, 'mask');

    // 16 sets the cutout bit by itself and 17 is the first count that carries into it. The
    // texture cache key takes its largest value too, so the rest of the key is as large as a
    // call can make it.
    for (const textureCount of [16, 17, 40]) {
      const opaque = sortKeyFor(0xffff, geom, textureCount, 0xffff);

      expect(opaque).toBeLessThan(cutout);
      expect(Number.isSafeInteger(opaque)).toBe(true);
    }

    // A cutout with that many textures still lands in the cutout group, and its key stays an
    // exact integer.
    const bigCutout = sortKeyFor(0xffff, geom, 40, 0xffff, 'mask');
    expect(bigCutout).toBeGreaterThan(cutout);
    expect(Number.isSafeInteger(bigCutout)).toBe(true);
  });

  it('groups every count past the field with 15 rather than wrapping round to 0', () => {
    const geom = geometry(5);

    expect(sortKeyFor(1, geom, 16)).toBe(sortKeyFor(1, geom, 15));
    expect(sortKeyFor(1, geom, 40)).toBe(sortKeyFor(1, geom, 15));
  });

  it('keeps the pipeline grouping within the cutout group', () => {
    const geom = geometry(5);
    const a = sortKeyFor(1, geom, 1, 0, 'mask');
    const b = sortKeyFor(2, geom, 1, 0, 'mask');

    expect(b - a).toBe(sortKeyFor(2, geom) - sortKeyFor(1, geom));
  });
});
