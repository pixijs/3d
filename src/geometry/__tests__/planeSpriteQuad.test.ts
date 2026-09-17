import { describe, expect, it } from 'vitest';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';

/** Reads Geometry3D's private teardown latch without an `any` cast. */
interface GeometryInternals {
  _destroyed: boolean;
}

describe('PlaneGeometry flipV', () => {
  it('runs v up the +Y axis by default', () => {
    const uvs = new PlaneGeometry().uvs as Float32Array;

    // Vertex 0 is the bottom-left corner.
    expect(uvs[1]).toBeCloseTo(0);
    // Vertex 2 is the top-left corner.
    expect(uvs[5]).toBeCloseTo(1);
  });

  it('puts v = 0 on the top edge when set', () => {
    const uvs = new PlaneGeometry({ flipV: true }).uvs as Float32Array;

    expect(uvs[1]).toBeCloseTo(1);
    expect(uvs[5]).toBeCloseTo(0);
  });

  it('flips v on every row of a subdivided plane', () => {
    const plain = new PlaneGeometry({ widthSegments: 4, heightSegments: 4 });
    const flipped = new PlaneGeometry({ widthSegments: 4, heightSegments: 4, flipV: true });
    const a = plain.uvs as Float32Array;
    const b = flipped.uvs as Float32Array;

    for (let i = 0; i < a.length; i += 2) {
      expect(b[i]).toBeCloseTo(a[i]); // u untouched
      expect(b[i + 1]).toBeCloseTo(1 - a[i + 1]);
    }
  });

  it('touches nothing but the UVs — positions, normals and winding hold', () => {
    const plain = new PlaneGeometry({ widthSegments: 3, heightSegments: 2 });
    const flipped = new PlaneGeometry({ widthSegments: 3, heightSegments: 2, flipV: true });

    expect(Array.from(flipped.positions as Float32Array)).toEqual(Array.from(plain.positions as Float32Array));
    expect(Array.from(flipped.normals as Float32Array)).toEqual(Array.from(plain.normals as Float32Array));
    expect(Array.from(flipped.indices as Uint16Array)).toEqual(Array.from(plain.indices as Uint16Array));
  });
});

describe('PlaneGeometry.spriteQuad', () => {
  it('matches the hand-authored quad it replaced, vertex for vertex', () => {
    const quad = PlaneGeometry.spriteQuad;

    // prettier-ignore
    expect(Array.from(quad.positions as Float32Array)).toEqual([
      -0.5, -0.5, 0,
       0.5, -0.5, 0,
      -0.5,  0.5, 0,
       0.5,  0.5, 0,
    ]);
    // Normals read back packed — snorm16 ×4 per vertex, where 32767 is +1. So
    // this is the uniform `+Z` the hand-authored quad supplied, after packing.
    // prettier-ignore
    expect(Array.from(quad.normals as Int16Array)).toEqual([
      0, 0, 32767, 0,
      0, 0, 32767, 0,
      0, 0, 32767, 0,
      0, 0, 32767, 0,
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

  it('returns the same instance every read', () => {
    expect(PlaneGeometry.spriteQuad).toBe(PlaneGeometry.spriteQuad);
  });

  it('is a 1×1 flipV plane, not a bespoke geometry', () => {
    const quad = PlaneGeometry.spriteQuad;
    const equivalent = new PlaneGeometry({ flipV: true });

    expect(quad).toBeInstanceOf(PlaneGeometry);
    expect(Array.from(quad.uvs as Float32Array)).toEqual(Array.from(equivalent.uvs as Float32Array));
  });

  it('carries image-orientation UVs — v = 0 on the top edge', () => {
    const quad = PlaneGeometry.spriteQuad;
    const positions = quad.positions as Float32Array;
    const uvs = quad.uvs as Float32Array;

    // Vertex 0 sits at the bottom-left of the quad, so it must sample the
    // BOTTOM of the image (v = 1). A v-up plane would read 0 here, which is
    // exactly what renders a PNG upside-down.
    expect(positions[0]).toBeCloseTo(-0.5);
    expect(positions[1]).toBeCloseTo(-0.5);
    expect(uvs[0]).toBeCloseTo(0);
    expect(uvs[1]).toBeCloseTo(1);

    // Vertex 2, top-left → image top-left.
    expect(positions[7]).toBeCloseTo(0.5);
    expect(uvs[4]).toBeCloseTo(0);
    expect(uvs[5]).toBeCloseTo(0);
  });

  it('ignores a direct destroy — buffers stay intact and it stays renderable', () => {
    const quad = PlaneGeometry.spriteQuad;

    quad.destroy(true);

    expect((quad as unknown as GeometryInternals)._destroyed).toBe(false);
    expect(quad.buffers).not.toBe(null);
    expect(quad.attributes.aPosition.buffer.destroyed).toBe(false);
    expect(quad.indexBuffer.destroyed).toBe(false);
    expect(quad.vertexCount).toBe(4);
  });

  it('has the bounding sphere both culls expect', () => {
    const quad = PlaneGeometry.spriteQuad;

    expect(quad.boundsSphere.center.x).toBeCloseTo(0);
    expect(quad.boundsSphere.center.y).toBeCloseTo(0);
    expect(quad.boundsSphere.center.z).toBeCloseTo(0);
    // Half the diagonal of a 1x1x0 box — the billboard rebuild can never push a
    // corner past it, whatever direction the camera faces.
    expect(quad.boundsSphere.radius).toBeCloseTo(Math.SQRT1_2);
  });
});
