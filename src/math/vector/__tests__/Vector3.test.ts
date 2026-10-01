import { describe, expect, test } from 'vitest';

import { Matrix3 } from '~/math/matrix/Matrix3';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { Quaternion } from '~/math/rotation/Quaternion';
import { Cylindrical } from '~/math/shapes/Cylindrical';
import { Spherical } from '~/math/shapes/Spherical';
import { Vector3 } from '~/math/vector/Vector3';

function expectVec3Close(actual: { x: number; y: number; z: number }, x: number, y: number, z: number) {
  expect(actual.x).toBeCloseTo(x, 5);
  expect(actual.y).toBeCloseTo(y, 5);
  expect(actual.z).toBeCloseTo(z, 5);
}

describe('Vector3 — construction and identity', () => {
  test('default constructor produces (0, 0, 0)', () => {
    const p = new Vector3();

    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
    expect(p.z).toBe(0);
  });

  test('toString reports the component values', () => {
    const p = new Vector3(1, 2, 3);

    expect(p.toString()).toBe('[pixi-3d/math:Vector3 x=1 y=2 z=3]');
  });
});

describe('Vector3.set', () => {
  test('no args resets to (0, 0, 0)', () => {
    const p = new Vector3(1, 2, 3);
    p.set();

    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
    expect(p.z).toBe(0);
  });

  test('single arg sets all three components to that value', () => {
    const p = new Vector3();
    p.set(5);

    expect(p.x).toBe(5);
    expect(p.y).toBe(5);
    expect(p.z).toBe(5);
  });

  test('two args set x explicitly and z defaults to x', () => {
    const p = new Vector3();
    p.set(1, 2);

    expect(p.x).toBe(1);
    expect(p.y).toBe(2);
    expect(p.z).toBe(1);
  });

  test('three args set each component independently', () => {
    const p = new Vector3();
    p.set(1, 2, 3);

    expect(p.x).toBe(1);
    expect(p.y).toBe(2);
    expect(p.z).toBe(3);
  });
});

describe('Vector3.copyFrom / copyTo', () => {
  test('copyFrom copies x, y, z', () => {
    const a = new Vector3();
    a.copyFrom({ x: 4, y: 5, z: 6 });

    expect(a.x).toBe(4);
    expect(a.y).toBe(5);
    expect(a.z).toBe(6);
  });

  test('copyTo writes into the target point and returns it', () => {
    const a = new Vector3(7, 8, 9);
    const b = new Vector3();
    const result = a.copyTo(b);

    expect(result).toBe(b);
    expect(b.x).toBe(7);
    expect(b.y).toBe(8);
    expect(b.z).toBe(9);
  });
});

describe('Vector3.equals', () => {
  test('returns true for exact componentwise match', () => {
    expect(new Vector3(1, 2, 3).equals({ x: 1, y: 2, z: 3 })).toBe(true);
  });

  test('returns false when any component differs', () => {
    expect(new Vector3(1, 2, 3).equals({ x: 1.0001, y: 2, z: 3 })).toBe(false);
    expect(new Vector3(1, 2, 3).equals({ x: 1, y: 2.0001, z: 3 })).toBe(false);
    expect(new Vector3(1, 2, 3).equals({ x: 1, y: 2, z: 3.0001 })).toBe(false);
  });
});

describe('Vector3.fromArray / toArray', () => {
  test('fromArray reads x, y, z from offset 0 by default', () => {
    const p = new Vector3();
    p.fromArray([1, 2, 3]);

    expect(p.x).toBe(1);
    expect(p.y).toBe(2);
    expect(p.z).toBe(3);
  });

  test('fromArray honors a non-zero offset', () => {
    const p = new Vector3();
    p.fromArray([0, 0, 1, 2, 3], 2);

    expect(p.x).toBe(1);
    expect(p.y).toBe(2);
    expect(p.z).toBe(3);
  });

  test('toArray allocates a new array when not supplied', () => {
    const p = new Vector3(1, 2, 3);
    const arr = p.toArray();

    expect(arr).toEqual([1, 2, 3]);
  });

  test('toArray writes into a supplied array at a non-zero offset', () => {
    const p = new Vector3(1, 2, 3);
    const arr = [0, 0, 0, 0, 0];
    p.toArray(arr, 2);

    expect(arr).toEqual([0, 0, 1, 2, 3]);
  });
});

describe('Vector3.add', () => {
  test('mutating-default adds componentwise', () => {
    const a = new Vector3(1, 2, 3);
    const result = a.add({ x: 4, y: 5, z: 6 });

    expect(result).toBe(a);
    expectVec3Close(a, 5, 7, 9);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(1, 2, 3);
    const out = new Vector3();
    a.add({ x: 4, y: 5, z: 6 }, out);

    expectVec3Close(out, 5, 7, 9);
    expectVec3Close(a, 1, 2, 3);
  });
});

describe('Vector3.subtract', () => {
  test('mutating-default subtracts componentwise', () => {
    const a = new Vector3(5, 7, 9);
    a.subtract({ x: 1, y: 2, z: 3 });

    expectVec3Close(a, 4, 5, 6);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(5, 7, 9);
    const out = new Vector3();
    a.subtract({ x: 1, y: 2, z: 3 }, out);

    expectVec3Close(out, 4, 5, 6);
    expectVec3Close(a, 5, 7, 9);
  });
});

describe('Vector3.multiply', () => {
  test('mutating-default multiplies componentwise', () => {
    const a = new Vector3(2, 3, 4);
    a.multiply({ x: 5, y: 6, z: 7 });

    expectVec3Close(a, 10, 18, 28);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(2, 3, 4);
    const out = new Vector3();
    a.multiply({ x: 5, y: 6, z: 7 }, out);

    expectVec3Close(out, 10, 18, 28);
    expectVec3Close(a, 2, 3, 4);
  });
});

describe('Vector3.multiplyScalar', () => {
  test('mutating-default multiplies each component by scalar', () => {
    const a = new Vector3(1, 2, 3);
    a.multiplyScalar(4);

    expectVec3Close(a, 4, 8, 12);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(1, 2, 3);
    const out = new Vector3();
    a.multiplyScalar(4, out);

    expectVec3Close(out, 4, 8, 12);
    expectVec3Close(a, 1, 2, 3);
  });
});

describe('Vector3.divide', () => {
  test('mutating-default divides componentwise', () => {
    const a = new Vector3(10, 20, 30);
    a.divide({ x: 2, y: 4, z: 5 });

    expectVec3Close(a, 5, 5, 6);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(10, 20, 30);
    const out = new Vector3();
    a.divide({ x: 2, y: 4, z: 5 }, out);

    expectVec3Close(out, 5, 5, 6);
    expectVec3Close(a, 10, 20, 30);
  });
});

describe('Vector3.divideScalar', () => {
  test('mutating-default divides each component by scalar', () => {
    const a = new Vector3(8, 12, 16);
    a.divideScalar(4);

    expectVec3Close(a, 2, 3, 4);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(8, 12, 16);
    const out = new Vector3();
    a.divideScalar(4, out);

    expectVec3Close(out, 2, 3, 4);
    expectVec3Close(a, 8, 12, 16);
  });
});

describe('Vector3.addScaledVector', () => {
  test('mutating-default adds v * s to this', () => {
    const a = new Vector3(1, 2, 3);
    a.addScaledVector({ x: 4, y: 5, z: 6 }, 2);

    expectVec3Close(a, 9, 12, 15);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(1, 2, 3);
    const out = new Vector3();
    a.addScaledVector({ x: 4, y: 5, z: 6 }, 2, out);

    expectVec3Close(out, 9, 12, 15);
    expectVec3Close(a, 1, 2, 3);
  });
});

describe('Vector3.negate', () => {
  test('mutating-default negates each component', () => {
    const a = new Vector3(1, -2, 3);
    a.negate();

    expectVec3Close(a, -1, 2, -3);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(1, -2, 3);
    const out = new Vector3();
    a.negate(out);

    expectVec3Close(out, -1, 2, -3);
    expectVec3Close(a, 1, -2, 3);
  });
});

describe('Vector3.min', () => {
  test('mutating-default takes componentwise minimum', () => {
    const a = new Vector3(3, 7, 2);
    a.min({ x: 5, y: 2, z: 9 });

    expectVec3Close(a, 3, 2, 2);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(3, 7, 2);
    const out = new Vector3();
    a.min({ x: 5, y: 2, z: 9 }, out);

    expectVec3Close(out, 3, 2, 2);
    expectVec3Close(a, 3, 7, 2);
  });
});

describe('Vector3.max', () => {
  test('mutating-default takes componentwise maximum', () => {
    const a = new Vector3(3, 7, 2);
    a.max({ x: 5, y: 2, z: 9 });

    expectVec3Close(a, 5, 7, 9);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(3, 7, 2);
    const out = new Vector3();
    a.max({ x: 5, y: 2, z: 9 }, out);

    expectVec3Close(out, 5, 7, 9);
    expectVec3Close(a, 3, 7, 2);
  });
});

describe('Vector3.clamp', () => {
  test('mutating-default clamps componentwise', () => {
    const a = new Vector3(-5, 5, 15);
    a.clamp({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });

    expectVec3Close(a, 0, 5, 10);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(-5, 5, 15);
    const out = new Vector3();
    a.clamp({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 }, out);

    expectVec3Close(out, 0, 5, 10);
    expectVec3Close(a, -5, 5, 15);
  });
});

describe('Vector3.normalize', () => {
  test('produces a unit-length vector', () => {
    const a = new Vector3(0, 3, 4);
    a.normalize();

    expectVec3Close(a, 0, 0.6, 0.8);
    expect(a.magnitude()).toBeCloseTo(1, 6);
  });

  test('zero-magnitude vector is left unchanged', () => {
    const a = new Vector3(0, 0, 0);
    a.normalize();

    expectVec3Close(a, 0, 0, 0);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(0, 3, 4);
    const out = new Vector3();
    a.normalize(out);

    expectVec3Close(out, 0, 0.6, 0.8);
    expectVec3Close(a, 0, 3, 4);
  });
});

describe('Vector3.setLength', () => {
  test('rescales to the requested length', () => {
    const a = new Vector3(0, 3, 4);
    a.setLength(10);

    expectVec3Close(a, 0, 6, 8);
    expect(a.magnitude()).toBeCloseTo(10, 6);
  });

  test('zero-magnitude vector is left unchanged', () => {
    const a = new Vector3(0, 0, 0);
    a.setLength(5);

    expectVec3Close(a, 0, 0, 0);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(0, 3, 4);
    const out = new Vector3();
    a.setLength(10, out);

    expectVec3Close(out, 0, 6, 8);
    expectVec3Close(a, 0, 3, 4);
  });
});

describe('Vector3.magnitude / magnitudeSquared', () => {
  test('magnitude returns the Euclidean length', () => {
    expect(new Vector3(0, 3, 4).magnitude()).toBeCloseTo(5, 6);
    expect(new Vector3(2, 3, 6).magnitude()).toBeCloseTo(7, 6);
    expect(new Vector3(0, 0, 0).magnitude()).toBe(0);
  });

  test('magnitudeSquared returns the squared Euclidean length', () => {
    expect(new Vector3(0, 3, 4).magnitudeSquared()).toBe(25);
    expect(new Vector3(1, 2, 2).magnitudeSquared()).toBe(9);
  });
});

describe('Vector3.distanceTo / distanceToSquared', () => {
  test('distanceTo returns Euclidean distance', () => {
    const a = new Vector3(1, 2, 3);
    expect(a.distanceTo({ x: 1, y: 5, z: 7 })).toBeCloseTo(5, 6);
  });

  test('distanceToSquared returns squared Euclidean distance', () => {
    const a = new Vector3(1, 2, 3);
    expect(a.distanceToSquared({ x: 1, y: 5, z: 7 })).toBe(25);
  });
});

describe('Vector3.dot', () => {
  test('returns sum of componentwise products', () => {
    expect(new Vector3(1, 2, 3).dot({ x: 4, y: 5, z: 6 })).toBe(32);
  });
});

describe('Vector3.angleTo', () => {
  test('parallel unit vectors have angle 0', () => {
    const a = new Vector3(1, 0, 0);
    expect(a.angleTo({ x: 1, y: 0, z: 0 })).toBeCloseTo(0, 6);
  });

  test('orthogonal vectors have angle PI/2', () => {
    const a = new Vector3(1, 0, 0);
    expect(a.angleTo({ x: 0, y: 1, z: 0 })).toBeCloseTo(Math.PI / 2, 6);
  });

  test('antiparallel vectors have angle PI', () => {
    const a = new Vector3(1, 0, 0);
    expect(a.angleTo({ x: -1, y: 0, z: 0 })).toBeCloseTo(Math.PI, 6);
  });

  test('zero-magnitude this returns PI/2', () => {
    const a = new Vector3(0, 0, 0);
    expect(a.angleTo({ x: 1, y: 0, z: 0 })).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe('Vector3.cross', () => {
  test('(1,0,0) x (0,1,0) = (0,0,1)', () => {
    const a = new Vector3(1, 0, 0);
    a.cross({ x: 0, y: 1, z: 0 });

    expectVec3Close(a, 0, 0, 1);
  });

  test('(0,1,0) x (1,0,0) = (0,0,-1)', () => {
    const a = new Vector3(0, 1, 0);
    a.cross({ x: 1, y: 0, z: 0 });

    expectVec3Close(a, 0, 0, -1);
  });

  test('(0,0,1) x (1,0,0) = (0,1,0)', () => {
    const a = new Vector3(0, 0, 1);
    a.cross({ x: 1, y: 0, z: 0 });

    expectVec3Close(a, 0, 1, 0);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(1, 0, 0);
    const out = new Vector3();
    a.cross({ x: 0, y: 1, z: 0 }, out);

    expectVec3Close(out, 0, 0, 1);
    expectVec3Close(a, 1, 0, 0);
  });
});

describe('Vector3.applyMatrix3', () => {
  test('column-major scaling matrix scales each component', () => {
    const a = new Vector3(1, 2, 3);
    const m = new Matrix3();
    m.elements[0] = 2;
    m.elements[4] = 3;
    m.elements[8] = 4;
    a.applyMatrix3(m);

    expectVec3Close(a, 2, 6, 12);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(1, 2, 3);
    const out = new Vector3();
    const m = new Matrix3();
    m.elements[0] = 2;
    m.elements[4] = 3;
    m.elements[8] = 4;
    a.applyMatrix3(m, out);

    expectVec3Close(out, 2, 6, 12);
    expectVec3Close(a, 1, 2, 3);
  });
});

describe('Vector3.applyMatrix4', () => {
  test('translation matrix translates the point (treated as w=1)', () => {
    const a = new Vector3(1, 2, 3);
    const m = new Matrix4().makeTranslation(10, 20, 30);
    a.applyMatrix4(m);

    expectVec3Close(a, 11, 22, 33);
  });

  test('rotation around Y by PI/2 sends +X to -Z', () => {
    const a = new Vector3(1, 0, 0);
    const m = new Matrix4().makeRotationY(Math.PI / 2);
    a.applyMatrix4(m);

    expectVec3Close(a, 0, 0, -1);
  });

  test('perspective divide: a perspective matrix at z = -near maps to z = -1 (NDC)', () => {
    const near = 1;
    const far = 100;
    const m = new Matrix4().makePerspective(Math.PI / 2, 1, near, far);
    const a = new Vector3(0, 0, -near);
    a.applyMatrix4(m);

    expect(a.z).toBeCloseTo(-1, 5);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(1, 2, 3);
    const out = new Vector3();
    const m = new Matrix4().makeTranslation(10, 20, 30);
    a.applyMatrix4(m, out);

    expectVec3Close(out, 11, 22, 33);
    expectVec3Close(a, 1, 2, 3);
  });
});

describe('Vector3.applyAffineMatrix4', () => {
  test('translation matrix translates the point', () => {
    const a = new Vector3(1, 2, 3);
    const m = new Matrix4().makeTranslation(10, 20, 30);
    a.applyAffineMatrix4(m);

    expectVec3Close(a, 11, 22, 33);
  });

  test('rotation around Y by PI/2 sends +X to -Z', () => {
    const a = new Vector3(1, 0, 0);
    const m = new Matrix4().makeRotationY(Math.PI / 2);
    a.applyAffineMatrix4(m);

    expectVec3Close(a, 0, 0, -1);
  });

  test('matches applyMatrix4 for affine matrices (rotation + translation + scale)', () => {
    const m = new Matrix4()
      .makeRotationY(Math.PI / 3)
      .multiply(new Matrix4().makeTranslation(4, -5, 6))
      .multiply(new Matrix4().makeScale(2, 3, 4));

    const a = new Vector3(1.5, -2.25, 0.75);
    const b = new Vector3(1.5, -2.25, 0.75);
    a.applyMatrix4(m);
    b.applyAffineMatrix4(m);

    expectVec3Close(b, a.x, a.y, a.z);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(1, 2, 3);
    const out = new Vector3();
    const m = new Matrix4().makeTranslation(10, 20, 30);
    a.applyAffineMatrix4(m, out);

    expectVec3Close(out, 11, 22, 33);
    expectVec3Close(a, 1, 2, 3);
  });
});

describe('Vector3.applyQuaternion', () => {
  test('180° rotation around Y sends +X to -X', () => {
    const a = new Vector3(1, 0, 0);
    const q = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI);
    a.applyQuaternion(q);

    expectVec3Close(a, -1, 0, 0);
  });

  test('90° rotation around Y sends +X to -Z', () => {
    const a = new Vector3(1, 0, 0);
    const q = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    a.applyQuaternion(q);

    expectVec3Close(a, 0, 0, -1);
  });

  test('180° rotation around Z sends +X to -X and +Y to -Y', () => {
    const q = new Quaternion().setFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI);

    const a = new Vector3(1, 0, 0);
    a.applyQuaternion(q);
    expectVec3Close(a, -1, 0, 0);

    const b = new Vector3(0, 1, 0);
    b.applyQuaternion(q);
    expectVec3Close(b, 0, -1, 0);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(1, 0, 0);
    const out = new Vector3();
    const q = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI);
    a.applyQuaternion(q, out);

    expectVec3Close(out, -1, 0, 0);
    expectVec3Close(a, 1, 0, 0);
  });
});

describe('Vector3.transformDirection', () => {
  test('ignores translation', () => {
    const a = new Vector3(1, 0, 0);
    const m = new Matrix4().makeTranslation(100, 200, 300);
    a.transformDirection(m);

    expectVec3Close(a, 1, 0, 0);
  });

  test('rotates around Y by PI/2 sends +X to -Z', () => {
    const a = new Vector3(1, 0, 0);
    const m = new Matrix4().makeRotationY(Math.PI / 2);
    a.transformDirection(m);

    expectVec3Close(a, 0, 0, -1);
  });

  test('result is normalized to unit length', () => {
    const a = new Vector3(3, 0, 0);
    const identity = new Matrix4();
    a.transformDirection(identity);

    expect(a.magnitude()).toBeCloseTo(1, 6);
    expectVec3Close(a, 1, 0, 0);
  });

  test('out variant leaves this unchanged', () => {
    const a = new Vector3(1, 0, 0);
    const out = new Vector3();
    const m = new Matrix4().makeRotationY(Math.PI / 2);
    a.transformDirection(m, out);

    expectVec3Close(out, 0, 0, -1);
    expectVec3Close(a, 1, 0, 0);
  });
});

describe('Vector3.setFromSpherical', () => {
  test('phi = 0 places point on +Y axis at radius', () => {
    const a = new Vector3();
    a.setFromSpherical(new Spherical(5, 0, 0));

    expectVec3Close(a, 0, 5, 0);
  });

  test('phi = PI/2, theta = 0 places point on +Z axis at radius', () => {
    const a = new Vector3();
    a.setFromSpherical(new Spherical(5, Math.PI / 2, 0));

    expectVec3Close(a, 0, 0, 5);
  });

  test('phi = PI/2, theta = PI/2 places point on +X axis at radius', () => {
    const a = new Vector3();
    a.setFromSpherical(new Spherical(5, Math.PI / 2, Math.PI / 2));

    expectVec3Close(a, 5, 0, 0);
  });
});

describe('Vector3.setFromCylindrical', () => {
  test('theta = 0 places point on +Z axis at radius, with y carried through', () => {
    const a = new Vector3();
    a.setFromCylindrical(new Cylindrical(5, 0, 7));

    expectVec3Close(a, 0, 7, 5);
  });

  test('theta = PI/2 places point on +X axis at radius', () => {
    const a = new Vector3();
    a.setFromCylindrical(new Cylindrical(5, Math.PI / 2, 0));

    expectVec3Close(a, 5, 0, 0);
  });
});

describe('Vector3.setFromMatrixColumn', () => {
  test('reads first three components of the requested column', () => {
    const m = new Matrix4().makeTranslation(7, 8, 9);

    const col0 = new Vector3().setFromMatrixColumn(m, 0);
    expectVec3Close(col0, 1, 0, 0);

    const col1 = new Vector3().setFromMatrixColumn(m, 1);
    expectVec3Close(col1, 0, 1, 0);

    const col2 = new Vector3().setFromMatrixColumn(m, 2);
    expectVec3Close(col2, 0, 0, 1);

    const col3 = new Vector3().setFromMatrixColumn(m, 3);
    expectVec3Close(col3, 7, 8, 9);
  });
});

describe('Vector3.shared', () => {
  test('mutations persist on the same reference until next access', () => {
    const s1 = Vector3.shared;
    s1.x = 99;
    s1.y = 88;
    s1.z = 77;

    const s2 = Vector3.shared;

    expect(s2).toBe(s1);
    expect(s2.x).toBe(0);
    expect(s2.y).toBe(0);
    expect(s2.z).toBe(0);
  });
});
