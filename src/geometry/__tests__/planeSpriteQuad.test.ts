import { describe, expect, it } from 'vitest';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';

/** Reads Geometry3D's private teardown latch without an `any` cast. */
interface GeometryInternals {
  _destroyed: boolean;
}

/** A normal component of +1 as it reads back once normals are quantized to snorm16, four lanes per vertex */
const SNORM16_ONE = 32767;

describe('PlaneGeometry flipV', () => {
  it('flips v on every row of a subdivided plane', () => {
    const plain = new PlaneGeometry({ widthSegments: 4, heightSegments: 4 });
    const flipped = new PlaneGeometry({ widthSegments: 4, heightSegments: 4, flipV: true });
    const a = plain.uvs as Float32Array;
    const b = flipped.uvs as Float32Array;

    for (let i = 0; i < a.length; i += 2) {
      expect(b[i]).toBeCloseTo(a[i]);
      expect(b[i + 1]).toBeCloseTo(1 - a[i + 1]);
    }
  });

  it('touches nothing but the UVs: positions, normals and winding hold', () => {
    const plain = new PlaneGeometry({ widthSegments: 3, heightSegments: 2 });
    const flipped = new PlaneGeometry({ widthSegments: 3, heightSegments: 2, flipV: true });

    expect(Array.from(flipped.positions as Float32Array)).toEqual(Array.from(plain.positions as Float32Array));
    expect(Array.from(flipped.normals as Float32Array)).toEqual(Array.from(plain.normals as Float32Array));
    expect(Array.from(flipped.indices as Uint16Array)).toEqual(Array.from(plain.indices as Uint16Array));
  });
});

describe('PlaneGeometry.spriteQuad', () => {
  it('is a 1x1 quad facing +Z with v = 0 on its top edge', () => {
    const quad = PlaneGeometry.spriteQuad;

    // prettier-ignore
    expect(Array.from(quad.positions as Float32Array)).toEqual([
      -0.5, -0.5, 0,
       0.5, -0.5, 0,
      -0.5,  0.5, 0,
       0.5,  0.5, 0,
    ]);
    // prettier-ignore
    expect(Array.from(quad.normals as Int16Array)).toEqual([
      0, 0, SNORM16_ONE, 0,
      0, 0, SNORM16_ONE, 0,
      0, 0, SNORM16_ONE, 0,
      0, 0, SNORM16_ONE, 0,
    ]);
    // prettier-ignore
    expect(Array.from(quad.uvs as Float32Array)).toEqual([
      0, 1,
      1, 1,
      0, 0,
      1, 0,
    ]);
    expect(Array.from(quad.indices as Uint16Array)).toEqual([0, 1, 2, 2, 1, 3]);
  });

  it('ignores a direct destroy: buffers stay intact and it stays renderable', () => {
    const quad = PlaneGeometry.spriteQuad;

    quad.destroy(true);

    expect((quad as unknown as GeometryInternals)._destroyed).toBe(false);
    expect(quad.buffers).not.toBe(null);
    expect(quad.attributes.aPosition.buffer.destroyed).toBe(false);
    expect(quad.indexBuffer.destroyed).toBe(false);
    expect(quad.vertexCount).toBe(4);
  });

  it('is bounded by a sphere of half its diagonal, which holds the quad at any rotation', () => {
    const quad = PlaneGeometry.spriteQuad;

    expect(quad.boundsSphere.center.x).toBeCloseTo(0);
    expect(quad.boundsSphere.center.y).toBeCloseTo(0);
    expect(quad.boundsSphere.center.z).toBeCloseTo(0);
    expect(quad.boundsSphere.radius).toBeCloseTo(Math.SQRT1_2);
  });
});
