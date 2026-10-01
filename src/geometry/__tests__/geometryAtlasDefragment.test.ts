import { describe, expect, it } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { GeometryAtlas } from '~/geometry/GeometryAtlas';
import { GeometryAtlasPool } from '~/geometry/GeometryAtlasPool';

/** A geometry with `vertexCount` vertices and as many indices */
function makeGeometry(vertexCount: number): Geometry3D {
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) positions[i * 3] = i;

  const indices = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) indices[i] = i;

  return new Geometry3D({ positions, indices });
}

/**
 * Vertex count of each geometry in the pool tests
 *
 * Three overflow the atlas's default 1024-vertex capacity but two fit, so a third add after a
 * removal fits the live set and `add` compacts rather than grows.
 */
const POOL_GEOMETRY_VERTICES = 400;

describe('GeometryAtlas.defragment', () => {
  it('versions a compaction that slides live allocations', () => {
    const atlas = new GeometryAtlas({ referenceGeometry: makeGeometry(4) });

    const first = makeGeometry(64);
    const second = makeGeometry(64);
    atlas.add(first);
    const secondAlloc = atlas.add(second);

    expect(secondAlloc.baseVertex).toBe(64);
    const version = atlas._bufferVersion;

    atlas.remove(first);
    atlas.defragment();

    expect(secondAlloc.baseVertex).toBe(0);
    expect(secondAlloc.firstIndex).toBe(0);
    expect(atlas._bufferVersion).not.toBe(version);
  });

  it('versions a compaction that only shrinks the tail, but not the removal before it', () => {
    const atlas = new GeometryAtlas({ referenceGeometry: makeGeometry(4) });

    const first = makeGeometry(64);
    const second = makeGeometry(64);
    const firstAlloc = atlas.add(first);
    atlas.add(second);

    const version = atlas._bufferVersion;

    atlas.remove(second);
    expect(atlas._bufferVersion).toBe(version);

    atlas.defragment();

    expect(firstAlloc.baseVertex).toBe(0);
    expect(atlas.vertexCount).toBe(64);
    expect(atlas._bufferVersion).not.toBe(version);
  });

  it('surfaces a compaction through the pool version', () => {
    const pool = new GeometryAtlasPool({ rebaseIndices: false });

    const first = makeGeometry(POOL_GEOMETRY_VERTICES);
    const second = makeGeometry(POOL_GEOMETRY_VERTICES);
    const third = makeGeometry(POOL_GEOMETRY_VERTICES);

    pool.allocate(first);
    const secondAlloc = pool.allocate(second);
    const version = pool.bufferVersion;

    first.destroy();
    expect(pool.allocate(third).baseVertex).toBe(POOL_GEOMETRY_VERTICES);

    expect(secondAlloc.baseVertex).toBe(0);
    expect(pool.bufferVersion).not.toBe(version);

    pool.clear();
  });

  it('versions a tail reuse through allocate, never through the removal', () => {
    const pool = new GeometryAtlasPool({ rebaseIndices: false });

    const first = makeGeometry(POOL_GEOMETRY_VERTICES);
    const second = makeGeometry(POOL_GEOMETRY_VERTICES);
    const third = makeGeometry(POOL_GEOMETRY_VERTICES);

    pool.allocate(first);
    const secondAlloc = pool.allocate(second);
    const version = pool.bufferVersion;

    second.destroy();
    expect(pool.bufferVersion).toBe(version);

    expect(pool.allocate(third).baseVertex).toBe(secondAlloc.baseVertex);
    expect(pool.bufferVersion).not.toBe(version);

    pool.clear();
  });
});
