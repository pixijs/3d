import { describe, expect, it } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';

// The batched draw path is index-based (the atlas packs by index range and the
// indirect draw args use one uniform indexed layout), so every Geometry3D must
// carry an index buffer. A geometry built without indices — e.g. a non-indexed
// glTF primitive or a streaming ribbon — gets a sequential [0..vertexCount) one.

describe('Geometry3D synthesizes an index buffer when none is supplied', () => {
  it('builds a sequential [0..vertexCount) index buffer for non-indexed input', () => {
    const geom = new Geometry3D({ positions: new Float32Array(9) }); // 3 vertices

    expect(geom.vertexCount).toBe(3);
    expect(geom.indexBuffer).toBeDefined();
    expect(geom.indexBuffer!.data.length).toBe(geom.vertexCount);
    expect(Array.from(geom.indexBuffer!.data)).toEqual([0, 1, 2]);
    // Odd count (3 × 2 bytes = 6, not a multiple of 4) forces the Uint32 upgrade.
    expect(geom.indexBuffer!.data).toBeInstanceOf(Uint32Array);
  });

  it('leaves supplied indices untouched', () => {
    const indices = new Uint32Array([0, 1, 2, 2, 1, 3]);
    const geom = new Geometry3D({ positions: new Float32Array(12), indices }); // 4 vertices

    expect(geom.indexBuffer).toBeDefined();
    expect(Array.from(geom.indexBuffer!.data)).toEqual([0, 1, 2, 2, 1, 3]);
  });
});
