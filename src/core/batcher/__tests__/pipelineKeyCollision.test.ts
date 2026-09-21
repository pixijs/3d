import { describe, expect, it } from 'vitest';

import { updateMesh3DKeys } from '../updateMesh3DKeys';

// The pipeline half of the batch key had the same fault as the geometry half: folded down
// to 16 bits, so two unrelated pipelines could compare equal and the batcher would merge
// their draws — the second mesh rendering with the first's shader and state.
//
// Unlike the geometry half, a colliding pair can't be constructed to order: the key comes
// from pixi and goes through a bit mixer, so a collision can only be searched for. What can
// be shown outright is the pigeonhole — hand the key more distinct pipelines than a 16-bit
// field has slots and a folded key MUST reuse one, while an exact key keeps every pair apart.

const SLOTS_16_BIT = 0x10000;
const PIPELINES = SLOTS_16_BIT + 1000;

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
      // Shaped like WebGPU's graphics-state key, which varies above bit 32 as well as below.
      updateMesh3DKeys(item, cache, i * 2 ** 20 + i);
      seen.add(cache.batchKey);
    }

    expect(seen.size).toBe(PIPELINES);
    expect(Number.isSafeInteger(cache.batchKey)).toBe(true);
  });
});
