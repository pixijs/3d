import { describe, expect, it, vi } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { GeometryAtlas } from '~/geometry/GeometryAtlas';
import { GeometryAtlasPool } from '~/geometry/GeometryAtlasPool';

function makeGeometry(vertexCount: number): Geometry3D {
  const geometry = new Geometry3D({ positions: new Float32Array(3), indices: new Uint32Array([0]) });
  vi.spyOn(geometry, 'vertexCount', 'get').mockReturnValue(vertexCount);
  return geometry;
}

const POSITION_ONLY_STRIDE = 12;
const BUFFER_CAP = 256 * 1024 * 1024;

describe('GeometryAtlas buffer cap', () => {
  it('grows to the limit rather than doubling past it', () => {
    const atlas = new GeometryAtlas({
      referenceGeometry: makeGeometry(4),
      initialVertexCapacity: 1024,
      initialIndexCapacity: 1024,
    });

    atlas.add(makeGeometry(16 * 1024 * 1024));
    atlas.add(makeGeometry(4 * 1024 * 1024));

    const vertexBuffer = Object.values(atlas.geometry.attributes)[0].buffer;
    expect(vertexBuffer.descriptor.size, 'doubling would exceed 256 MiB').toBe(
      Math.floor(BUFFER_CAP / POSITION_ONLY_STRIDE) * POSITION_ONLY_STRIDE,
    );
    expect(atlas.geometry.indexBuffer.descriptor.size).toBeLessThanOrEqual(BUFFER_CAP);
  });

  it('counts dead ranges as room, since add compacts them first', () => {
    const atlas = new GeometryAtlas({
      referenceGeometry: makeGeometry(4),
    });

    const first = makeGeometry(12 * 1024 * 1024);
    atlas.add(first);
    expect(atlas.fits(makeGeometry(12 * 1024 * 1024))).toBe(false);

    atlas.remove(first);
    expect(atlas.fits(makeGeometry(12 * 1024 * 1024))).toBe(true);
  });
});

describe('GeometryAtlasPool buffer cap', () => {
  it('opens another atlas for the layout instead of passing the limit', () => {
    const pool = new GeometryAtlasPool({ rebaseIndices: false });

    const first = pool.allocate(makeGeometry(12 * 1024 * 1024));
    const second = pool.allocate(makeGeometry(12 * 1024 * 1024));
    const third = pool.allocate(makeGeometry(4 * 1024 * 1024));

    expect(second.atlas).not.toBe(first.atlas);
    expect(third.atlas, 'a geometry that fits goes back to the first atlas').toBe(first.atlas);

    for (const atlas of [first.atlas, second.atlas]) {
      expect(Object.values(atlas.geometry.attributes)[0].buffer.descriptor.size).toBeLessThanOrEqual(BUFFER_CAP);
      expect(atlas.geometry.indexBuffer.descriptor.size).toBeLessThanOrEqual(BUFFER_CAP);
    }
  });

  it('warns when a single geometry passes the limit', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = new GeometryAtlasPool({ rebaseIndices: false });

    pool.allocate(makeGeometry(12 * 1024 * 1024));
    pool.allocate(makeGeometry(12 * 1024 * 1024));
    expect(warn, 'another atlas for the layout is not a failure').not.toHaveBeenCalled();

    pool.allocate(makeGeometry(24 * 1024 * 1024));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0])).toContain('dynamic');

    warn.mockRestore();
  });

  it('keeps an allocation made in any of its atlases', () => {
    const pool = new GeometryAtlasPool({ rebaseIndices: false });

    pool.allocate(makeGeometry(12 * 1024 * 1024));
    const geometry = makeGeometry(12 * 1024 * 1024);
    const allocation = pool.allocate(geometry);
    geometry._geometryAtlasAllocation = allocation;

    expect(pool.allocate(geometry)).toBe(allocation);
  });

  it('starts small rather than allocating the cap upfront', () => {
    const pool = new GeometryAtlasPool({ rebaseIndices: false });
    const { atlas } = pool.allocate(makeGeometry(4));

    expect(Object.values(atlas.geometry.attributes)[0].buffer.descriptor.size).toBe(1024 * POSITION_ONLY_STRIDE);
    expect(atlas.geometry.indexBuffer.descriptor.size).toBe(2048 * 4);
    pool.clear();
  });
});
