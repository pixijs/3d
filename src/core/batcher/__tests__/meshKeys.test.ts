import { describe, expect, it } from 'vitest';

import type { AlphaMode } from '~/materials/BaseMaterial3D';

import { updateMesh3DKeys } from '../updateMesh3DKeys';

/** 16 alone would set the cutout bit, and 17 is the first count to carry into it */
const OVERFLOWING_TEXTURE_COUNTS = [16, 17, 40];

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

  it('separates the same geometry across different pipelines', () => {
    const geom = geometry(77, 1);

    expect(batchKeyFor(500, geom)).not.toBe(batchKeyFor(501, geom));
  });
});

describe('updateMesh3DKeys sort key', () => {
  it('orders by texture layout, then pipeline, then geometry, then texture, each field outranking all below it', () => {
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

  it('groups atlased geometry by its atlas ahead of the geometry uid', () => {
    const pipelineKey = 910_001;

    expect(sortKeyFor(pipelineKey, geometry(5, 1))).toBeLessThan(sortKeyFor(pipelineKey, geometry(4, 2)));
  });
});

describe('updateMesh3DKeys cutout ordering', () => {
  it('sorts alpha-masked meshes after every opaque one, whatever their layout or pipeline', () => {
    const geom = geometry(5);
    const opaque = sortKeyFor(0xffff, geom, 15, 0xffff);
    const cutout = sortKeyFor(1, geom, 1, 0, 'mask');

    expect(cutout).toBeGreaterThan(opaque);
  });

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
