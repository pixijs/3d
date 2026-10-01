import { describe, expect, test } from 'vitest';

import { Matrix4 } from '~/math/matrix/Matrix4';
import { Quaternion } from '~/math/rotation/Quaternion';
import { Vector3 } from '~/math/vector/Vector3';

function expectQuatClose(
  actual: { x: number; y: number; z: number; w: number },
  x: number,
  y: number,
  z: number,
  w: number,
) {
  expect(actual.x).toBeCloseTo(x, 5);
  expect(actual.y).toBeCloseTo(y, 5);
  expect(actual.z).toBeCloseTo(z, 5);
  expect(actual.w).toBeCloseTo(w, 5);
}

/** Compares quaternions for "same rotation" — q and -q represent the same rotation. */
function expectSameRotation(
  actual: { x: number; y: number; z: number; w: number },
  expected: { x: number; y: number; z: number; w: number },
) {
  const dot = actual.x * expected.x + actual.y * expected.y + actual.z * expected.z + actual.w * expected.w;
  expect(Math.abs(dot)).toBeCloseTo(1, 5);
}

function expectVec3Close(actual: { x: number; y: number; z: number }, x: number, y: number, z: number) {
  expect(actual.x).toBeCloseTo(x, 5);
  expect(actual.y).toBeCloseTo(y, 5);
  expect(actual.z).toBeCloseTo(z, 5);
}

describe('Quaternion — constructor', () => {
  test('default values are identity (0, 0, 0, 1)', () => {
    const q = new Quaternion();
    expectQuatClose(q, 0, 0, 0, 1);
  });
});

describe('Quaternion.shared', () => {
  test('resets to identity each access (even after mutation)', () => {
    const s1 = Quaternion.shared;
    s1.set(0.5, 0.5, 0.5, 0.5);

    const s2 = Quaternion.shared;
    expectQuatClose(s2, 0, 0, 0, 1);
  });

  test('returns the same instance', () => {
    const s1 = Quaternion.shared;
    const s2 = Quaternion.shared;
    expect(s1).toBe(s2);
  });
});

describe('Quaternion.slerpFlat', () => {
  test('t=0 writes src0 into dst', () => {
    const dst = [0, 0, 0, 0];
    const src0 = [0.1, 0.2, 0.3, Math.sqrt(1 - 0.01 - 0.04 - 0.09)];
    const src1 = [0, 0, 0, 1];
    Quaternion.slerpFlat(dst, 0, src0, 0, src1, 0, 0);
    expect(dst[0]).toBeCloseTo(src0[0], 5);
    expect(dst[1]).toBeCloseTo(src0[1], 5);
    expect(dst[2]).toBeCloseTo(src0[2], 5);
    expect(dst[3]).toBeCloseTo(src0[3], 5);
  });

  test('t=1 writes src1 into dst', () => {
    const dst = [0, 0, 0, 0];
    const src0 = [0, 0, 0, 1];
    const src1 = [0.1, 0.2, 0.3, Math.sqrt(1 - 0.01 - 0.04 - 0.09)];
    Quaternion.slerpFlat(dst, 0, src0, 0, src1, 0, 1);
    expect(dst[0]).toBeCloseTo(src1[0], 5);
    expect(dst[1]).toBeCloseTo(src1[1], 5);
    expect(dst[2]).toBeCloseTo(src1[2], 5);
    expect(dst[3]).toBeCloseTo(src1[3], 5);
  });

  test('midpoint between two unit rotations is unit length', () => {
    const qa = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0);
    const qb = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const dst = [0, 0, 0, 0];
    Quaternion.slerpFlat(dst, 0, [qa.x, qa.y, qa.z, qa.w], 0, [qb.x, qb.y, qb.z, qb.w], 0, 0.5);

    const len = Math.sqrt(dst[0] * dst[0] + dst[1] * dst[1] + dst[2] * dst[2] + dst[3] * dst[3]);
    expect(len).toBeCloseTo(1, 5);

    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 4);
    expectSameRotation({ x: dst[0], y: dst[1], z: dst[2], w: dst[3] }, expected);
  });

  test('sign-flip path engages when dot < 0', () => {
    const qa = [0, 0, 0, 1];
    const qb = [0, 0, 0, -1];
    const dst = [0, 0, 0, 0];
    Quaternion.slerpFlat(dst, 0, qa, 0, qb, 0, 0.5);
    expect(dst[3]).toBeCloseTo(1, 5);
  });

  test('near-parallel fast path (dot >= 0.9995) takes lerp+normalize branch', () => {
    const qa = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0);
    const qb = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.001);
    const dst = [0, 0, 0, 0];
    Quaternion.slerpFlat(dst, 0, [qa.x, qa.y, qa.z, qa.w], 0, [qb.x, qb.y, qb.z, qb.w], 0, 0.5);

    const len = Math.sqrt(dst[0] * dst[0] + dst[1] * dst[1] + dst[2] * dst[2] + dst[3] * dst[3]);
    expect(len).toBeCloseTo(1, 5);
  });

  test('identical inputs short-circuit to src0', () => {
    const src0 = [0.1, 0.2, 0.3, 0.4];
    const src1 = [0.1, 0.2, 0.3, 0.4];
    const dst = [0, 0, 0, 0];
    Quaternion.slerpFlat(dst, 0, src0, 0, src1, 0, 0.5);
    expect(dst[0]).toBeCloseTo(src0[0], 5);
    expect(dst[1]).toBeCloseTo(src0[1], 5);
    expect(dst[2]).toBeCloseTo(src0[2], 5);
    expect(dst[3]).toBeCloseTo(src0[3], 5);
  });

  test('respects offsets', () => {
    const dst = [0, 0, 0, 0, 0, 0, 0, 0];
    const src0 = [9, 9, 0, 0, 0, 1];
    const src1 = [9, 9, 0, 0, 0, 1];
    Quaternion.slerpFlat(dst, 4, src0, 2, src1, 2, 0.5);
    expect(dst[4]).toBeCloseTo(0, 5);
    expect(dst[5]).toBeCloseTo(0, 5);
    expect(dst[6]).toBeCloseTo(0, 5);
    expect(dst[7]).toBeCloseTo(1, 5);
  });
});

describe('Quaternion — basic accessors', () => {
  test('set updates components', () => {
    const q = new Quaternion();
    q.set(0.1, 0.2, 0.3, 0.4);
    expectQuatClose(q, 0.1, 0.2, 0.3, 0.4);
  });

  test('copyFrom copies values from a QuaternionData', () => {
    const a = new Quaternion(0.1, 0.2, 0.3, 0.4);
    const b = new Quaternion();
    b.copyFrom(a);
    expectQuatClose(b, 0.1, 0.2, 0.3, 0.4);
  });

  test('copyTo writes into the target', () => {
    const a = new Quaternion(0.1, 0.2, 0.3, 0.4);
    const b = new Quaternion();
    const ret = a.copyTo(b);
    expect(ret).toBe(b);
    expectQuatClose(b, 0.1, 0.2, 0.3, 0.4);
  });

  test('identity resets to (0, 0, 0, 1)', () => {
    const q = new Quaternion(0.1, 0.2, 0.3, 0.4);
    q.identity();
    expectQuatClose(q, 0, 0, 0, 1);
  });

  test('equals returns true for matching components', () => {
    const a = new Quaternion(0.1, 0.2, 0.3, 0.4);
    const b = new Quaternion(0.1, 0.2, 0.3, 0.4);
    expect(a.equals(b)).toBe(true);
  });

  test('equals returns false for any differing component', () => {
    const a = new Quaternion(0.1, 0.2, 0.3, 0.4);
    expect(a.equals({ x: 0, y: 0.2, z: 0.3, w: 0.4 })).toBe(false);
    expect(a.equals({ x: 0.1, y: 0, z: 0.3, w: 0.4 })).toBe(false);
    expect(a.equals({ x: 0.1, y: 0.2, z: 0, w: 0.4 })).toBe(false);
    expect(a.equals({ x: 0.1, y: 0.2, z: 0.3, w: 0 })).toBe(false);
  });

  test('toString includes components', () => {
    const q = new Quaternion(0.1, 0.2, 0.3, 0.4);
    expect(q.toString()).toContain('Quaternion');
    expect(q.toString()).toContain('0.1');
    expect(q.toString()).toContain('0.4');
  });
});

describe('Quaternion — array I/O', () => {
  test('fromArray reads x, y, z, w starting at offset 0', () => {
    const q = new Quaternion();
    q.fromArray([0.1, 0.2, 0.3, 0.4]);
    expectQuatClose(q, 0.1, 0.2, 0.3, 0.4);
  });

  test('fromArray respects offset', () => {
    const q = new Quaternion();
    q.fromArray([9, 9, 0.1, 0.2, 0.3, 0.4], 2);
    expectQuatClose(q, 0.1, 0.2, 0.3, 0.4);
  });

  test('toArray allocates and writes values', () => {
    const q = new Quaternion(0.1, 0.2, 0.3, 0.4);
    const arr = q.toArray();
    expect(arr).toHaveLength(4);
    expect(arr[0]).toBeCloseTo(0.1, 5);
    expect(arr[1]).toBeCloseTo(0.2, 5);
    expect(arr[2]).toBeCloseTo(0.3, 5);
    expect(arr[3]).toBeCloseTo(0.4, 5);
  });

  test('toArray writes into supplied array at offset', () => {
    const q = new Quaternion(0.1, 0.2, 0.3, 0.4);
    const arr = [9, 9, 0, 0, 0, 0];
    q.toArray(arr, 2);
    expect(arr[2]).toBeCloseTo(0.1, 5);
    expect(arr[3]).toBeCloseTo(0.2, 5);
    expect(arr[4]).toBeCloseTo(0.3, 5);
    expect(arr[5]).toBeCloseTo(0.4, 5);
  });
});

describe('Quaternion.setFromEuler', () => {
  test('X-only rotation matches setFromAxisAngle({1,0,0}, x)', () => {
    const angle = Math.PI / 3;
    const fromEuler = new Quaternion().setFromEuler({ x: angle, y: 0, z: 0 });
    const fromAxis = new Quaternion().setFromAxisAngle({ x: 1, y: 0, z: 0 }, angle);
    expectQuatClose(fromEuler, fromAxis.x, fromAxis.y, fromAxis.z, fromAxis.w);
  });

  test('Y-only rotation matches setFromAxisAngle({0,1,0}, y)', () => {
    const angle = Math.PI / 3;
    const fromEuler = new Quaternion().setFromEuler({ x: 0, y: angle, z: 0 });
    const fromAxis = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, angle);
    expectQuatClose(fromEuler, fromAxis.x, fromAxis.y, fromAxis.z, fromAxis.w);
  });

  test('Z-only rotation matches setFromAxisAngle({0,0,1}, z)', () => {
    const angle = Math.PI / 3;
    const fromEuler = new Quaternion().setFromEuler({ x: 0, y: 0, z: angle });
    const fromAxis = new Quaternion().setFromAxisAngle({ x: 0, y: 0, z: 1 }, angle);
    expectQuatClose(fromEuler, fromAxis.x, fromAxis.y, fromAxis.z, fromAxis.w);
  });

  test('writes into out without mutating source', () => {
    const src = new Quaternion(0.1, 0.2, 0.3, 0.4);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    src.setFromEuler({ x: Math.PI / 2, y: 0, z: 0 }, out);
    expectQuatClose(src, 0.1, 0.2, 0.3, 0.4);
    expect(out.w).toBeCloseTo(Math.cos(Math.PI / 4), 5);
  });
});

describe('Quaternion.setFromAxisAngle', () => {
  test('90° around Y produces (0, sin(45°), 0, cos(45°))', () => {
    const q = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    expectQuatClose(q, 0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4));
    expect(q.y).toBeCloseTo(Math.SQRT1_2, 5);
    expect(q.w).toBeCloseTo(Math.SQRT1_2, 5);
  });

  test('result is unit length for unit axis', () => {
    const q = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 1.234);
    expect(q.magnitude()).toBeCloseTo(1, 5);
  });

  test('writes into out without mutating source', () => {
    const src = new Quaternion(0.1, 0.2, 0.3, 0.4);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    src.setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2, out);
    expectQuatClose(src, 0.1, 0.2, 0.3, 0.4);
    expect(out.y).toBeCloseTo(Math.SQRT1_2, 5);
  });
});

describe('Quaternion.setFromRotationMatrix', () => {
  test('Y rotation matrix recovers setFromAxisAngle quaternion', () => {
    const theta = Math.PI / 3;
    const m = new Matrix4().makeRotationY(theta);
    const recovered = new Quaternion().setFromRotationMatrix(m);
    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, theta);
    expectSameRotation(recovered, expected);
  });

  test('X rotation matrix recovers setFromAxisAngle quaternion', () => {
    const theta = Math.PI / 4;
    const m = new Matrix4().makeRotationX(theta);
    const recovered = new Quaternion().setFromRotationMatrix(m);
    const expected = new Quaternion().setFromAxisAngle({ x: 1, y: 0, z: 0 }, theta);
    expectSameRotation(recovered, expected);
  });

  test('Z rotation matrix recovers setFromAxisAngle quaternion', () => {
    const theta = Math.PI / 5;
    const m = new Matrix4().makeRotationZ(theta);
    const recovered = new Quaternion().setFromRotationMatrix(m);
    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 0, z: 1 }, theta);
    expectSameRotation(recovered, expected);
  });

  test('180° rotation around X exercises m11-largest off-diagonal branch', () => {
    const m = new Matrix4().makeRotationX(Math.PI);
    const q = new Quaternion().setFromRotationMatrix(m);
    const expected = new Quaternion().setFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI);
    expectSameRotation(q, expected);
  });

  test('180° rotation around Y exercises m22-largest off-diagonal branch', () => {
    const m = new Matrix4().makeRotationY(Math.PI);
    const q = new Quaternion().setFromRotationMatrix(m);
    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI);
    expectSameRotation(q, expected);
  });

  test('180° rotation around Z exercises m33-largest off-diagonal branch', () => {
    const m = new Matrix4().makeRotationZ(Math.PI);
    const q = new Quaternion().setFromRotationMatrix(m);
    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI);
    expectSameRotation(q, expected);
  });

  test('writes into out without mutating source', () => {
    const src = new Quaternion(0.1, 0.2, 0.3, 0.4);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    const m = new Matrix4().makeRotationY(Math.PI / 4);
    src.setFromRotationMatrix(m, out);
    expectQuatClose(src, 0.1, 0.2, 0.3, 0.4);
    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 4);
    expectSameRotation(out, expected);
  });
});

describe('Quaternion.setFromScaledRotationMatrix', () => {
  test('extracts rotation from TRS matrix with non-uniform scale', () => {
    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 3);
    const m = new Matrix4().compose({ x: 5, y: -2, z: 7 }, expected, { x: 2, y: 3, z: 4 });

    const recovered = new Quaternion().setFromScaledRotationMatrix(m);
    expectSameRotation(recovered, expected);
  });

  test('extracts identity rotation from a non-uniform scale-only matrix', () => {
    const m = new Matrix4().compose({ x: 0, y: 0, z: 0 }, new Quaternion(), { x: 4, y: 2, z: 6 });
    const q = new Quaternion().setFromScaledRotationMatrix(m);
    expectQuatClose(q, 0, 0, 0, 1);
  });

  test('writes into out without mutating source', () => {
    const src = new Quaternion(0.1, 0.2, 0.3, 0.4);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 4);
    const m = new Matrix4().compose({ x: 0, y: 0, z: 0 }, expected, { x: 2, y: 3, z: 4 });

    src.setFromScaledRotationMatrix(m, out);
    expectQuatClose(src, 0.1, 0.2, 0.3, 0.4);
    expectSameRotation(out, expected);
  });
});

describe('Quaternion.setFromUnitVectors', () => {
  test('parallel vectors produce identity', () => {
    const q = new Quaternion().setFromUnitVectors({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expectQuatClose(q, 0, 0, 0, 1);
  });

  test('antiparallel vectors produce 180° rotation around perpendicular axis', () => {
    const vFrom = new Vector3(1, 0, 0);
    const vTo = new Vector3(-1, 0, 0);
    const q = new Quaternion().setFromUnitVectors(vFrom, vTo);

    const rotated = vFrom.clone().applyQuaternion(q);
    expectVec3Close(rotated, -1, 0, 0);
    expect(q.magnitude()).toBeCloseTo(1, 5);
  });

  test('antiparallel vectors with z-dominant input pick a different perpendicular axis', () => {
    const vFrom = new Vector3(0, 0, 1);
    const vTo = new Vector3(0, 0, -1);
    const q = new Quaternion().setFromUnitVectors(vFrom, vTo);

    const rotated = vFrom.clone().applyQuaternion(q);
    expectVec3Close(rotated, 0, 0, -1);
    expect(q.magnitude()).toBeCloseTo(1, 5);
  });

  test('+X to +Y produces 90° rotation around +Z', () => {
    const q = new Quaternion().setFromUnitVectors({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2);
    expectSameRotation(q, expected);
  });

  test('result is normalized', () => {
    const q = new Quaternion().setFromUnitVectors({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(q.magnitude()).toBeCloseTo(1, 5);
  });

  test('writes into out without mutating source', () => {
    const src = new Quaternion(0.1, 0.2, 0.3, 0.4);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    src.setFromUnitVectors({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, out);
    expectQuatClose(src, 0.1, 0.2, 0.3, 0.4);
    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2);
    expectSameRotation(out, expected);
  });
});

describe('Quaternion — dot and angles', () => {
  test('perpendicular quaternions have dot 0', () => {
    const a = new Quaternion(1, 0, 0, 0);
    const b = new Quaternion(0, 1, 0, 0);
    expect(a.dot(b)).toBeCloseTo(0, 5);
  });

  test('angleTo between two rotations equals difference in their angles', () => {
    const a = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0);
    const b = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 3);
    expect(a.angleTo(b)).toBeCloseTo(Math.PI / 3, 5);
  });
});

describe('Quaternion — magnitude', () => {
  test('magnitude of (1, 1, 1, 1) is 2', () => {
    const q = new Quaternion(1, 1, 1, 1);
    expect(q.magnitude()).toBeCloseTo(2, 5);
    expect(q.magnitudeSquared()).toBeCloseTo(4, 5);
  });
});

describe('Quaternion.normalize', () => {
  test('zero quaternion becomes identity', () => {
    const q = new Quaternion(0, 0, 0, 0);
    q.normalize();
    expectQuatClose(q, 0, 0, 0, 1);
  });

  test('non-zero quaternion becomes unit length', () => {
    const q = new Quaternion(2, 0, 0, 0);
    q.normalize();
    expect(q.magnitude()).toBeCloseTo(1, 5);
    expectQuatClose(q, 1, 0, 0, 0);
  });

  test('preserves direction', () => {
    const q = new Quaternion(2, 4, 6, 8);
    const m = q.magnitude();
    q.normalize();
    expect(q.x).toBeCloseTo(2 / m, 5);
    expect(q.y).toBeCloseTo(4 / m, 5);
    expect(q.z).toBeCloseTo(6 / m, 5);
    expect(q.w).toBeCloseTo(8 / m, 5);
  });

  test('writes into out without mutating source', () => {
    const src = new Quaternion(2, 0, 0, 0);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    src.normalize(out);
    expectQuatClose(src, 2, 0, 0, 0);
    expectQuatClose(out, 1, 0, 0, 0);
  });
});

describe('Quaternion.inverse and conjugate', () => {
  test('conjugate negates imaginary part', () => {
    const q = new Quaternion(0.1, 0.2, 0.3, 0.4);
    q.conjugate();
    expectQuatClose(q, -0.1, -0.2, -0.3, 0.4);
  });

  test('inverse equals conjugate for unit quaternions', () => {
    const q = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 3);
    const inv = q.clone().inverse();
    const conj = q.clone().conjugate();
    expectQuatClose(inv, conj.x, conj.y, conj.z, conj.w);
  });

  test('q * q.conjugate() = identity for unit q', () => {
    const q = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.7);
    const conj = q.clone().conjugate();
    const result = q.clone().multiply(conj);
    expectQuatClose(result, 0, 0, 0, 1);
  });

  test('conjugate writes into out without mutating source', () => {
    const src = new Quaternion(0.1, 0.2, 0.3, 0.4);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    src.conjugate(out);
    expectQuatClose(src, 0.1, 0.2, 0.3, 0.4);
    expectQuatClose(out, -0.1, -0.2, -0.3, 0.4);
  });

  test('inverse writes into out without mutating source', () => {
    const src = new Quaternion(0.1, 0.2, 0.3, 0.4);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    src.inverse(out);
    expectQuatClose(src, 0.1, 0.2, 0.3, 0.4);
    expectQuatClose(out, -0.1, -0.2, -0.3, 0.4);
  });
});

describe('Quaternion.multiply and premultiply', () => {
  test('multiplication is non-commutative in general', () => {
    const a = new Quaternion().setFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2);
    const b = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);

    const ab = a.clone().multiply(b);
    const ba = b.clone().multiply(a);
    const equal =
      Math.abs(ab.x - ba.x) < 1e-5 &&
      Math.abs(ab.y - ba.y) < 1e-5 &&
      Math.abs(ab.z - ba.z) < 1e-5 &&
      Math.abs(ab.w - ba.w) < 1e-5;
    expect(equal).toBe(false);
  });

  test('rotating by q1 then q2 equals single rotation by q2 * q1', () => {
    const q1 = new Quaternion().setFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 4);
    const q2 = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 4);

    const point = new Vector3(0.3, 0.5, 0.7);
    const stepwise = point.clone().applyQuaternion(q1).applyQuaternion(q2);

    const combined = q2.clone().multiply(q1);
    const direct = point.clone().applyQuaternion(combined);

    expectVec3Close(stepwise, direct.x, direct.y, direct.z);
  });

  test('premultiply equals other.multiply(this)', () => {
    const a = new Quaternion().setFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.5);
    const b = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.7);

    const pre = a.clone().premultiply(b);
    const ba = b.clone().multiply(a);
    expectQuatClose(pre, ba.x, ba.y, ba.z, ba.w);
  });

  test('multiply writes into out without mutating either source', () => {
    const a = new Quaternion(0.1, 0.2, 0.3, 0.4);
    const b = new Quaternion(0.5, 0.6, 0.7, 0.8);
    const aOrig = a.clone();
    const bOrig = b.clone();
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    a.multiply(b, out);
    expectQuatClose(a, aOrig.x, aOrig.y, aOrig.z, aOrig.w);
    expectQuatClose(b, bOrig.x, bOrig.y, bOrig.z, bOrig.w);
    const expected = a.clone().multiply(b);
    expectQuatClose(out, expected.x, expected.y, expected.z, expected.w);
  });
});

describe('Quaternion.slerp', () => {
  test('t=0 returns this (no mutation when out=this)', () => {
    const a = new Quaternion(0.1, 0.2, 0.3, 0.4);
    const b = new Quaternion(0.5, 0.6, 0.7, 0.8);
    a.slerp(b, 0);
    expectQuatClose(a, 0.1, 0.2, 0.3, 0.4);
  });

  test('t=0 with different out copies this into out', () => {
    const a = new Quaternion(0.1, 0.2, 0.3, 0.4);
    const b = new Quaternion(0.5, 0.6, 0.7, 0.8);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    a.slerp(b, 0, out);
    expectQuatClose(out, 0.1, 0.2, 0.3, 0.4);
    expectQuatClose(a, 0.1, 0.2, 0.3, 0.4);
  });

  test('t=1 returns qb', () => {
    const a = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0);
    const b = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    a.slerp(b, 1);
    expectQuatClose(a, b.x, b.y, b.z, b.w);
  });

  test('midpoint slerp produces unit-length result', () => {
    const a = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0);
    const b = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    a.slerp(b, 0.5);
    expect(a.magnitude()).toBeCloseTo(1, 5);

    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 4);
    expectSameRotation(a, expected);
  });

  test('sign-flip path on antiparallel qb produces unit-length result', () => {
    const a = new Quaternion(0, 0, 0, 1);
    const b = new Quaternion(0, 0, 0, -1);
    a.slerp(b, 0.5);
    expect(a.magnitude()).toBeCloseTo(1, 5);
  });

  test('near-parallel fast path takes lerp+normalize branch', () => {
    const a = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0);
    const b = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.0005);
    a.slerp(b, 0.5);
    expect(a.magnitude()).toBeCloseTo(1, 5);
  });

  test('writes into out without mutating source', () => {
    const a = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0);
    const aOrig = a.clone();
    const b = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    a.slerp(b, 0.5, out);
    expectQuatClose(a, aOrig.x, aOrig.y, aOrig.z, aOrig.w);
    expect(out.w).toBeCloseTo(Math.cos(Math.PI / 8), 5);
  });
});

describe('Quaternion — math sanity', () => {
  test('applyQuaternion matches makeRotationFromQuaternion + applyMatrix4', () => {
    const q = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 3);
    const m = new Matrix4().makeRotationFromQuaternion(q);

    const p = new Vector3(0.3, 0.5, 0.7);
    const viaQuat = p.clone().applyQuaternion(q);
    const viaMat = p.clone().applyMatrix4(m);

    expectVec3Close(viaQuat, viaMat.x, viaMat.y, viaMat.z);
  });

  test('quaternion composition matches matrix composition', () => {
    const q1 = new Quaternion().setFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 4);
    const q2 = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 4);

    const m1 = new Matrix4().makeRotationFromQuaternion(q1);
    const m2 = new Matrix4().makeRotationFromQuaternion(q2);

    const composedQuat = q2.clone().multiply(q1);
    const mFromComposedQuat = new Matrix4().makeRotationFromQuaternion(composedQuat);

    const composedMat = m2.clone().multiply(m1);

    const p = new Vector3(0.4, 0.5, 0.6);
    const viaQuat = p.clone().applyMatrix4(mFromComposedQuat);
    const viaMat = p.clone().applyMatrix4(composedMat);
    expectVec3Close(viaQuat, viaMat.x, viaMat.y, viaMat.z);
  });

  test('rotating a point by q then by q^-1 returns to start', () => {
    const q = new Quaternion().setFromAxisAngle({ x: 0.5, y: 0.5, z: 0.5 }, Math.PI / 3).normalize();
    const inv = q.clone().inverse();

    const p = new Vector3(1, 2, 3);
    const round = p.clone().applyQuaternion(q).applyQuaternion(inv);
    expectVec3Close(round, 1, 2, 3);
  });
});
