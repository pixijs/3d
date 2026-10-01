import { describe, expect, it } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';

describe('Geometry3D synthesizes an index buffer when none is supplied', () => {
  it('builds a sequential [0..vertexCount) index buffer, widening an odd count to Uint32 for 4-byte alignment', () => {
    const geom = new Geometry3D({ positions: new Float32Array(9) });

    expect(geom.vertexCount).toBe(3);
    expect(geom.indexBuffer).toBeDefined();
    expect(geom.indexBuffer!.data.length).toBe(geom.vertexCount);
    expect(Array.from(geom.indexBuffer!.data)).toEqual([0, 1, 2]);
    expect(geom.indexBuffer!.data).toBeInstanceOf(Uint32Array);
  });

  it('leaves supplied indices untouched', () => {
    const indices = new Uint32Array([0, 1, 2, 2, 1, 3]);
    const geom = new Geometry3D({ positions: new Float32Array(12), indices });

    expect(geom.indexBuffer).toBeDefined();
    expect(Array.from(geom.indexBuffer!.data)).toEqual([0, 1, 2, 2, 1, 3]);
  });
});
