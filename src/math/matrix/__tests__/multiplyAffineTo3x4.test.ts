import { describe, expect, it } from 'vitest';

import { Matrix4 } from '~/math/matrix/Matrix4';

describe('Matrix4.multiplyAffineTo3x4', () => {
  it('writes the transpose of the twelve informative lanes multiplyAffine produces', () => {
    // Two arbitrary affines built by hand, so the test does not depend on compose().
    const a = new Float32Array([0.36, 0.48, -0.8, 0, -0.8, 0.6, 0, 0, 0.48, 0.64, 0.6, 0, 5, -3, 2, 1]);
    const b = new Float32Array([2, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 3, 0, -1, 7, 4, 1]);

    const asMat4 = new Float32Array(16);
    const asRows = new Float32Array(12);

    Matrix4.multiplyAffine(asMat4, 0, a, 0, b, 0);
    Matrix4.multiplyAffineTo3x4(asRows, 0, a, 0, b, 0);

    // Row-major 3x4 against column-major 4x4: rows[r * 4 + c] === mat4[c * 4 + r].
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        expect(asRows[r * 4 + c]).toBeCloseTo(asMat4[c * 4 + r], 6);
      }
    }
  });

  it('drops a non-affine bottom row rather than propagating it', () => {
    // A malformed inverse bind with a projective bottom row. multiplyAffine already
    // ignores those lanes, so the 3x4 form must agree with it exactly.
    const a = new Float32Array([1, 0, 0, 0.9, 0, 1, 0, -0.2, 0, 0, 1, 0.4, 0, 0, 0, 7]);
    const b = new Float32Array([1, 0, 0, 0.3, 0, 1, 0, 0.1, 0, 0, 1, -0.5, 2, 3, 4, 9]);

    const asMat4 = new Float32Array(16);
    const asRows = new Float32Array(12);

    Matrix4.multiplyAffine(asMat4, 0, a, 0, b, 0);
    Matrix4.multiplyAffineTo3x4(asRows, 0, a, 0, b, 0);

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        expect(asRows[r * 4 + c]).toBeCloseTo(asMat4[c * 4 + r], 6);
      }
    }
  });

  it('honours the offsets so a packed array can be written in place', () => {
    const a = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]);
    const b = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1]);

    const out = new Float32Array(24).fill(-1);

    Matrix4.multiplyAffineTo3x4(out, 12, a, 0, b, 0);

    // First entry untouched, second holds identity-rotation with the summed translation.
    expect(Array.from(out.subarray(0, 12))).toEqual(Array.from({ length: 12 }, () => -1));
    expect(out[12 + 3]).toBeCloseTo(11, 6);
    expect(out[12 + 7]).toBeCloseTo(22, 6);
    expect(out[12 + 11]).toBeCloseTo(33, 6);
  });
});
