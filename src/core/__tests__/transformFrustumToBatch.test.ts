import { describe, expect, it } from 'vitest';

import { transformFrustumToBatch } from '~/core/cull';
import { Matrix4 } from '~/math/matrix/Matrix4';

/**
 * A stride-20 store row with `m` in its first 16 lanes, column-major: what the cull reads as the
 * batch world matrix `B`
 */
const storeRow = (m: Matrix4) => {
  const f32 = new Float32Array(20);
  f32.set(m.elements.subarray(0, 16));
  return f32;
};

/** Applies an affine, column-major matrix to a point */
const apply = (m: Matrix4, x: number, y: number, z: number) => {
  const e = m.elements;
  return {
    x: e[0] * x + e[4] * y + e[8] * z + e[12],
    y: e[1] * x + e[5] * y + e[9] * z + e[13],
    z: e[2] * x + e[6] * y + e[10] * z + e[14],
  };
};

describe('transformFrustumToBatch', () => {
  it('preserves signed distances: a batch-local point matches its world image under a rigid B', () => {
    /** A 90° turn about Z, then a move by (10, 5, -3): rigid, so it preserves distances */
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
    expect(out, 'a non-identity B returns the transformed scratch').not.toBe(planes);

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
