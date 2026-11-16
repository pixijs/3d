import { describe, expect, it, vi } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { GeometryAtlas } from '~/geometry/GeometryAtlas';
import { GeometryAtlasPool } from '~/geometry/GeometryAtlasPool';

function makeGeometry(vertexCount: number): Geometry3D {
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) positions[i * 3] = i;

  const indices = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) indices[i] = i;

  return new Geometry3D({ positions, indices });
}

const POSITION_ONLY_STRIDE = 12;

describe('GeometryAtlas maxBufferBytes', () => {
  it('grows to the limit rather than doubling past it', () => {
    const atlas = new GeometryAtlas({
      referenceGeometry: makeGeometry(4),
      initialVertexCapacity: 1024,
      initialIndexCapacity: 1024,
      maxBufferBytes: 1500 * POSITION_ONLY_STRIDE,
    });

    atlas.add(makeGeometry(1000));
    atlas.add(makeGeometry(400));

    const vertexBuffer = Object.values(atlas.geometry.attributes)[0].buffer;
    expect(vertexBuffer.data.byteLength, 'doubling would make 2048 vertices').toBe(1500 * POSITION_ONLY_STRIDE);
    expect(atlas.geometry.indexBuffer.data.byteLength).toBeLessThanOrEqual(1500 * POSITION_ONLY_STRIDE);
  });

  it('counts dead ranges as room, since add compacts them first', () => {
    const atlas = new GeometryAtlas({
      referenceGeometry: makeGeometry(4),
      maxBufferBytes: 1500 * POSITION_ONLY_STRIDE,
    });

    const first = makeGeometry(1000);
    atlas.add(first);
    expect(atlas.fits(makeGeometry(600))).toBe(false);

    atlas.remove(first);
    expect(atlas.fits(makeGeometry(600))).toBe(true);
  });
});

describe('GeometryAtlasPool maxBufferBytes', () => {
  it('opens another atlas for the layout instead of passing the limit', () => {
    const pool = new GeometryAtlasPool({ rebaseIndices: false });
    pool.maxBufferBytes = 1500 * POSITION_ONLY_STRIDE;

    const first = pool.allocate(makeGeometry(1000));
    const second = pool.allocate(makeGeometry(1000));
    const third = pool.allocate(makeGeometry(400));

    expect(second.atlas).not.toBe(first.atlas);
    expect(third.atlas, 'a geometry that fits goes back to the first atlas').toBe(first.atlas);

    for (const atlas of [first.atlas, second.atlas]) {
      expect(Object.values(atlas.geometry.attributes)[0].buffer.data.byteLength).toBeLessThanOrEqual(
        1500 * POSITION_ONLY_STRIDE,
      );
      expect(atlas.geometry.indexBuffer.data.byteLength).toBeLessThanOrEqual(1500 * POSITION_ONLY_STRIDE);
    }
  });

  it('warns when a single geometry passes the limit', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = new GeometryAtlasPool({ rebaseIndices: false });
    pool.maxBufferBytes = 1500 * POSITION_ONLY_STRIDE;

    pool.allocate(makeGeometry(1000));
    pool.allocate(makeGeometry(1000));
    expect(warn, 'another atlas for the layout is not a failure').not.toHaveBeenCalled();

    pool.allocate(makeGeometry(2000));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0])).toContain('dynamic');

    warn.mockRestore();
  });

  it('keeps an allocation made in any of its atlases', () => {
    const pool = new GeometryAtlasPool({ rebaseIndices: false });
    pool.maxBufferBytes = 1500 * POSITION_ONLY_STRIDE;

    pool.allocate(makeGeometry(1000));
    const geometry = makeGeometry(1000);
    const allocation = pool.allocate(geometry);
    geometry._geometryAtlasAllocation = allocation;

    expect(pool.allocate(geometry)).toBe(allocation);
  });

  it('only ever lowers the limit, and passes it to atlases already open', () => {
    const pool = new GeometryAtlasPool({ rebaseIndices: false });
    const { atlas } = pool.allocate(makeGeometry(4));

    pool.maxBufferBytes = 4096;
    pool.maxBufferBytes = 1 << 30;

    expect(pool.maxBufferBytes).toBe(4096);
    expect(atlas.maxBufferBytes).toBe(4096);
  });
});
