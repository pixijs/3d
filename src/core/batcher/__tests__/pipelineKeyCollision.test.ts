import { describe, expect, it } from 'vitest';

import { updateMesh3DKeys } from '../updateMesh3DKeys';

/** Values a 16-bit field can hold */
const SLOTS_16_BIT = 0x10000;
/** More pipelines than a 16-bit field holds, so a key folded to 16 bits would have to reuse one */
const PIPELINES = SLOTS_16_BIT + 1000;

/**
 * A pipeline key shaped like WebGPU's, which varies above bit 32 as well as below
 * @param i - Which pipeline
 */
const webGpuShapedKey = (i: number): number => i * 2 ** 20 + i;

describe('batch key with many distinct pipelines', () => {
  it('keeps more pipelines apart than a 16-bit field has slots', () => {
    const item = {
      _sortKey: 0,
      geometry: { uid: 4242, _geometryAtlasAllocation: null },
      material: { textureCacheKey: 0, _textures: { length: 1 }, alphaMode: 'opaque' as const },
    };
    const cache = { batchKey: 0 };
    const seen = new Set<number>();

    for (let i = 0; i < PIPELINES; i++) {
      updateMesh3DKeys(item, cache, webGpuShapedKey(i));
      seen.add(cache.batchKey);
    }

    expect(seen.size).toBe(PIPELINES);
    expect(Number.isSafeInteger(cache.batchKey)).toBe(true);
  });
});
