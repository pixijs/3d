import { describe, expect, it } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { GeometryAtlas } from '~/geometry/GeometryAtlas';
import { GeometryAtlasPool } from '~/geometry/GeometryAtlasPool';

// Compaction is the one path besides growth that leaves recorded draw commands stale: it slides
// live allocations to new `baseVertex` / `firstIndex` offsets, or frees a tail range the next add
// overwrites. Anything watching `_bufferVersion` needs to see both. A removal on its own changes
// nothing a command reads, so it stays silent.

/** A geometry of `vertexCount` vertices, indexed as a fan so the index count tracks it. */
function makeGeometry(vertexCount: number): Geometry3D {
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) positions[i * 3] = i;

  const indices = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) indices[i] = i;

  return new Geometry3D({ positions, indices });
}

describe('GeometryAtlas.defragment', () => {
  it('versions a compaction that slides live allocations', () => {
    const atlas = new GeometryAtlas({ referenceGeometry: makeGeometry(4) });

    const first = makeGeometry(64);
    const second = makeGeometry(64);
    atlas.add(first);
    const secondAlloc = atlas.add(second);

    expect(secondAlloc.baseVertex).toBe(64);
    const version = atlas._bufferVersion;

    // Free the allocation *below* `second`, so compaction has to slide it down.
    atlas.remove(first);
    atlas.defragment();

    expect(secondAlloc.baseVertex).toBe(0);
    expect(secondAlloc.firstIndex).toBe(0);
    expect(atlas._bufferVersion).not.toBe(version);
  });

  it('versions a compaction that only shrinks the tail', () => {
    const atlas = new GeometryAtlas({ referenceGeometry: makeGeometry(4) });

    const first = makeGeometry(64);
    const second = makeGeometry(64);
    const firstAlloc = atlas.add(first);
    atlas.add(second);

    const version = atlas._bufferVersion;

    // Only the last allocation goes, so nothing slides and the removal itself is silent. The
    // compaction still has to version: the tail is where the next add lands, and a command
    // recorded for `second` before its removal would read that add's bytes.
    atlas.remove(second);
    expect(atlas._bufferVersion).toBe(version);

    atlas.defragment();

    expect(firstAlloc.baseVertex).toBe(0);
    expect(atlas.vertexCount).toBe(64);
    expect(atlas._bufferVersion).not.toBe(version);
  });

  it('surfaces a compaction through the pool version', () => {
    const pool = new GeometryAtlasPool({ rebaseIndices: false });

    // Sized so the third add doesn't fit the high watermark but does fit the live set,
    // which is the branch `add` resolves by compacting rather than growing.
    const first = makeGeometry(400);
    const second = makeGeometry(400);
    const third = makeGeometry(400);

    pool.allocate(first);
    const secondAlloc = pool.allocate(second);
    const version = pool.bufferVersion;

    first.destroy();
    expect(pool.allocate(third).baseVertex).toBe(400);

    expect(secondAlloc.baseVertex).toBe(0);
    expect(pool.bufferVersion).not.toBe(version);

    pool.clear();
  });

  it('versions a tail reuse through allocate, never through the removal', () => {
    const pool = new GeometryAtlasPool({ rebaseIndices: false });

    const first = makeGeometry(400);
    const second = makeGeometry(400);
    const third = makeGeometry(400);

    pool.allocate(first);
    const secondAlloc = pool.allocate(second);
    const version = pool.bufferVersion;

    // Vacating the tail moves nothing, so no View sharing the pool rebuilds for it.
    second.destroy();
    expect(pool.bufferVersion).toBe(version);

    // 800 + 400 overflows the 1024-vertex watermark but the live 400 + 400 fits, so allocate
    // compacts: the extent shrinks and `third` lands on `second`'s old range. Commands recorded
    // for `second` before its removal would now draw `third`'s bytes, so the version has to move.
    expect(pool.allocate(third).baseVertex).toBe(secondAlloc.baseVertex);
    expect(pool.bufferVersion).not.toBe(version);

    pool.clear();
  });
});
