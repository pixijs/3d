import { describe, expect, it } from 'vitest';

import { transformFrustumToBatch } from '~/core/cull';
import { Matrix4 } from '~/math/matrix/Matrix4';

// A stride-20 store row with matrix `m` in the first 16 lanes (column-major) — what the cull reads
// as store row 0 (the batch world matrix `B`).
const storeRow = (m: Matrix4) => {
  const f32 = new Float32Array(20);
  f32.set(m.elements.subarray(0, 16));
  return f32;
};

// Apply an affine (column-major) matrix to a point.
const apply = (m: Matrix4, x: number, y: number, z: number) => {
  const e = m.elements;
  return {
    x: e[0] * x + e[4] * y + e[8] * z + e[12],
    y: e[1] * x + e[5] * y + e[9] * z + e[13],
    z: e[2] * x + e[6] * y + e[10] * z + e[14],
  };
};

describe('transformFrustumToBatch', () => {
  it('returns the planes unchanged (same reference) for an identity batch matrix', () => {
    const planes = new Float32Array(24);
    for (let i = 0; i < 24; i += 4) planes[i] = 1; // unit +x normals
    expect(transformFrustumToBatch(planes, storeRow(new Matrix4()))).toBe(planes);
  });

  it('preserves signed distances: a batch-local point matches its world image under a rigid B', () => {
    // Rigid B: 90° rotation about Z + translation (10, 5, -3), column-major. Rotation + translation
    // preserve distances, so a batch-local point tested against the transformed planes must give the
    // same signed distance as its world image (B·p) tested against the original world planes.
    const B = new Matrix4();
    B.elements.set([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 10, 5, -3, 1]);

    const world = [
      [1, 0, 0, -2],
      [-1, 0, 0, 3],
      [0, 1, 0, -1],
      [0, -1, 0, 4],
      [0, 0, 1, -5],
      [0, 0, -1, 2],
    ];
    const planes = new Float32Array(world.flat());
    const out = transformFrustumToBatch(planes, storeRow(B));
    expect(out).not.toBe(planes); // non-identity → transformed copy

    for (let p = 0; p < 6; p++) {
      const [nx, ny, nz, w] = world[p];
      const o = p * 4;
      for (const [x, y, z] of [
        [0, 0, 0],
        [1, 2, 3],
        [-5, 4, -1],
      ]) {
        const wp = apply(B, x, y, z);
        const worldDist = nx * wp.x + ny * wp.y + nz * wp.z + w;
        const batchDist = out[o] * x + out[o + 1] * y + out[o + 2] * z + out[o + 3];
        expect(batchDist).toBeCloseTo(worldDist, 4);
      }
    }
  });
});
