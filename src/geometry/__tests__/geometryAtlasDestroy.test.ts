import type { Buffer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { GeometryAtlas } from '~/geometry/GeometryAtlas';

/** Reads the atlas's private live buffer pair without an `any` cast. */
interface AtlasBuffers {
  _vertexBuffer: Buffer;
  _indexBuffer: Buffer;
}

describe('GeometryAtlas.destroy', () => {
  it('frees vertex/index buffers orphaned by capacity growth', () => {
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
    // The merged Geometry wrapper built at construction; growth orphans it.
    const initialMergedGeometry = atlas.geometry;

    // Add a geometry far larger than the initial capacity to force both
    // _ensureVertexCapacity and _ensureIndexCapacity to grow (retiring the pair).
    const positions = new Float32Array(100 * 3);
    const indices = new Uint32Array(150);
    for (let i = 0; i < indices.length; i++) indices[i] = i % 100;
    const added = new Geometry3D({ positions, indices });
    atlas.add(added);

    expect(internals._vertexBuffer).not.toBe(initialVertexBuffer);
    expect(internals._indexBuffer).not.toBe(initialIndexBuffer);
    expect(atlas.geometry).not.toBe(initialMergedGeometry);
    expect(initialVertexBuffer.destroyed).toBe(false);

    atlas.destroy();

    // Retired atlas buffers are GC-exempt, so they leak unless destroy() frees them explicitly.
    expect(initialVertexBuffer.destroyed).toBe(true);
    expect(initialIndexBuffer.destroyed).toBe(true);
    // The orphaned merged-geometry wrapper's GPU layout is freed too (pixi nulls
    // `buffers` on destroy).
    expect(initialMergedGeometry.buffers).toBe(null);

    added.destroy(true);
    reference.destroy(true);
  });
});
