import type { Buffer, Geometry } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { GeometryAtlas } from '~/geometry/GeometryAtlas';

interface AtlasBuffers {
  _vertexBuffer: Buffer;
  _indexBuffer: Buffer;
  _buildMergedGeometry(): Geometry;
}

describe('GeometryAtlas.destroy', () => {
  it('frees the vertex/index buffers and merged geometry orphaned by capacity growth once the retire list empties', async () => {
    const reference = new Geometry3D({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    });

    const atlas = new GeometryAtlas({
      referenceGeometry: reference,
      initialVertexCapacity: 4,
      initialIndexCapacity: 4,
    });

    const internals = atlas as unknown as AtlasBuffers;
    const initialVertexBuffer = internals._vertexBuffer;
    const initialIndexBuffer = internals._indexBuffer;
    const initialMergedGeometry = atlas.geometry;

    const positions = new Float32Array(100 * 3);
    const indices = new Uint32Array(150);
    for (let i = 0; i < indices.length; i++) indices[i] = i % 100;
    const oversized = new Geometry3D({ positions, indices });
    const build = vi.spyOn(internals, '_buildMergedGeometry');
    atlas.add(oversized);
    expect(build).toHaveBeenCalledTimes(1);
    expect(initialMergedGeometry.indexBuffer).toBe(initialIndexBuffer);

    expect(internals._vertexBuffer).not.toBe(initialVertexBuffer);
    expect(internals._indexBuffer).not.toBe(initialIndexBuffer);
    expect(atlas.geometry).not.toBe(initialMergedGeometry);
    expect(initialVertexBuffer.destroyed).toBe(false);

    atlas.destroy();
    await Promise.resolve();

    expect(initialVertexBuffer.destroyed).toBe(true);
    expect(initialIndexBuffer.destroyed).toBe(true);
    expect(initialMergedGeometry.buffers).toBe(null);

    oversized.destroy(true);
    reference.destroy(true);
  });
});
