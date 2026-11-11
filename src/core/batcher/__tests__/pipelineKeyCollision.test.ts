import { describe, expect, it } from 'vitest';

import { updateMesh3DKeys } from '../updateMesh3DKeys';

const SLOTS_16_BIT = 0x10000;
const PIPELINES = SLOTS_16_BIT + 1000;

const webGpuShapedKey = (i: number): number => i * 2 ** 20 + i;

describe('batch key with many distinct pipelines', () => {
  it('keeps more pipelines apart than a 16-bit field has slots', () => {
    const item = {
      _sortKey: 0,
      geometry: { uid: 4242, _geometryAtlasAllocation: null },
      material: { uid: 1, _textures: [{ source: { uid: 7 } }], _textureSetId: 0, alphaMode: 'opaque' as const },
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
