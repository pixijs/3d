import { describe, expect, test } from 'vitest';

import { Matrix4 } from '~/math/matrix/Matrix4';
import { ObservableQuaternion } from '~/math/rotation/ObservableQuaternion';
import { Quaternion } from '~/math/rotation/Quaternion';

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

function expectSameRotation(
  actual: { x: number; y: number; z: number; w: number },
  expected: { x: number; y: number; z: number; w: number },
) {
  const dot = actual.x * expected.x + actual.y * expected.y + actual.z * expected.z + actual.w * expected.w;
  expect(Math.abs(dot)).toBeCloseTo(1, 5);
}

function makeObserver() {
  const counter = { count: 0 };
  const observer = {
    _onUpdate() {
      counter.count++;
    },
  };
  return { counter, observer };
}

describe('ObservableQuaternion — constructor', () => {
  test('default values are identity (0, 0, 0, 1)', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    expectQuatClose(q, 0, 0, 0, 1);
    expect(counter.count).toBe(0);
  });
});

describe('ObservableQuaternion — component setters', () => {
  test('x setter fires observer when value changes', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.x = 1.5;
    expect(counter.count).toBe(1);
    expect(q.x).toBeCloseTo(1.5, 5);
  });

  test('y setter fires observer when value changes', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.y = 1.5;
    expect(counter.count).toBe(1);
    expect(q.y).toBeCloseTo(1.5, 5);
  });

  test('z setter fires observer when value changes', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.z = 1.5;
    expect(counter.count).toBe(1);
    expect(q.z).toBeCloseTo(1.5, 5);
  });

  test('w setter fires observer when value changes', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.w = 0.5;
    expect(counter.count).toBe(1);
    expect(q.w).toBeCloseTo(0.5, 5);
  });

  test('setting same x value does not fire observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    q.x = 0.1;
    expect(counter.count).toBe(0);
  });

  test('setting same y value does not fire observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    q.y = 0.2;
    expect(counter.count).toBe(0);
  });

  test('setting same z value does not fire observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    q.z = 0.3;
    expect(counter.count).toBe(0);
  });

  test('setting same w value does not fire observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    q.w = 0.4;
    expect(counter.count).toBe(0);
  });
});

describe('ObservableQuaternion.set', () => {
  test('fires observer once when any component changes', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.set(0.1, 0.2, 0.3, 0.4);
    expect(counter.count).toBe(1);
    expectQuatClose(q, 0.1, 0.2, 0.3, 0.4);
  });

  test('no-op (same components) does not fire observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    q.set(0.1, 0.2, 0.3, 0.4);
    expect(counter.count).toBe(0);
  });
});

describe('ObservableQuaternion.copyFrom', () => {
  test('fires observer once when any component changes', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.copyFrom({ x: 0.1, y: 0.2, z: 0.3, w: 0.4 });
    expect(counter.count).toBe(1);
    expectQuatClose(q, 0.1, 0.2, 0.3, 0.4);
  });

  test('copyFrom with identical values does not fire observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    q.copyFrom({ x: 0.1, y: 0.2, z: 0.3, w: 0.4 });
    expect(counter.count).toBe(0);
  });
});

describe('ObservableQuaternion.copyTo', () => {
  test('writes into target without firing observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    const target = new Quaternion();
    const ret = q.copyTo(target);
    expect(ret).toBe(target);
    expectQuatClose(target, 0.1, 0.2, 0.3, 0.4);
    expect(counter.count).toBe(0);
  });
});

describe('ObservableQuaternion.clone', () => {
  test('produces a new equal ObservableQuaternion without firing observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    const c = q.clone();
    expect(c).not.toBe(q);
    expectQuatClose(c, 0.1, 0.2, 0.3, 0.4);
    expect(counter.count).toBe(0);
  });

  test('clone reuses the same observer when none provided', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    const c = q.clone();
    c.x = 9;
    expect(counter.count).toBe(1);
  });

  test('clone with explicit observer uses that one', () => {
    const a = makeObserver();
    const b = makeObserver();
    const q = new ObservableQuaternion(a.observer, 0.1, 0.2, 0.3, 0.4);
    const c = q.clone(b.observer);
    c.x = 9;
    expect(a.counter.count).toBe(0);
    expect(b.counter.count).toBe(1);
  });
});

describe('ObservableQuaternion.identity', () => {
  test('fires observer when changing from non-identity', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    q.identity();
    expect(counter.count).toBe(1);
    expectQuatClose(q, 0, 0, 0, 1);
  });

  test('does not fire observer when already identity', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.identity();
    expect(counter.count).toBe(0);
  });
});

describe('ObservableQuaternion.equals', () => {
  test('returns true for matching components without firing observer', () => {
    const { observer, counter } = makeObserver();
    const a = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    expect(a.equals({ x: 0.1, y: 0.2, z: 0.3, w: 0.4 })).toBe(true);
    expect(counter.count).toBe(0);
  });

  test('returns false for any differing component without firing observer', () => {
    const { observer, counter } = makeObserver();
    const a = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    expect(a.equals({ x: 0, y: 0.2, z: 0.3, w: 0.4 })).toBe(false);
    expect(a.equals({ x: 0.1, y: 0, z: 0.3, w: 0.4 })).toBe(false);
    expect(a.equals({ x: 0.1, y: 0.2, z: 0, w: 0.4 })).toBe(false);
    expect(a.equals({ x: 0.1, y: 0.2, z: 0.3, w: 0 })).toBe(false);
    expect(counter.count).toBe(0);
  });
});

describe('ObservableQuaternion.setFromEuler', () => {
  test('zero rotation sets identity (no fire when starting from identity)', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.setFromEuler({ x: 0, y: 0, z: 0 });
    expectQuatClose(q, 0, 0, 0, 1);
    expect(counter.count).toBe(0);
  });

  test('non-zero rotation fires observer once', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.setFromEuler({ x: 0, y: Math.PI / 2, z: 0 });
    expect(counter.count).toBe(1);

    const expected = new Quaternion().setFromEuler({ x: 0, y: Math.PI / 2, z: 0 });
    expectQuatClose(q, expected.x, expected.y, expected.z, expected.w);
  });

  test('writes into out without firing observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    q.setFromEuler({ x: 0, y: Math.PI / 2, z: 0 }, out);
    expect(counter.count).toBe(0);

    const expected = new Quaternion().setFromEuler({ x: 0, y: Math.PI / 2, z: 0 });
    expectQuatClose(out, expected.x, expected.y, expected.z, expected.w);
  });
});

describe('ObservableQuaternion.setFromAxisAngle', () => {
  test('fires observer once on real change', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    expect(counter.count).toBe(1);
    expect(q.y).toBeCloseTo(Math.SQRT1_2, 5);
    expect(q.w).toBeCloseTo(Math.SQRT1_2, 5);
  });

  test('matches non-observable Quaternion result', () => {
    const { observer } = makeObserver();
    const q = new ObservableQuaternion(observer);
    const ref = new Quaternion();
    q.setFromAxisAngle({ x: 0.5, y: 0.5, z: 0.5 }, 1.234);
    ref.setFromAxisAngle({ x: 0.5, y: 0.5, z: 0.5 }, 1.234);
    expectQuatClose(q, ref.x, ref.y, ref.z, ref.w);
  });

  test('writes into out without firing observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    q.setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2, out);
    expect(counter.count).toBe(0);
    expect(out.y).toBeCloseTo(Math.SQRT1_2, 5);
    expect(out.w).toBeCloseTo(Math.SQRT1_2, 5);
  });

  test('zero angle starting from identity produces no change (no fire)', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.setFromAxisAngle({ x: 1, y: 0, z: 0 }, 0);
    expect(counter.count).toBe(0);
  });
});

describe('ObservableQuaternion.setFromRotationMatrix', () => {
  test('fires observer once on real change', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    const m = new Matrix4().makeRotationY(Math.PI / 3);
    q.setFromRotationMatrix(m);
    expect(counter.count).toBe(1);
    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 3);
    expectSameRotation(q, expected);
  });

  test('writes into out without firing observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    const m = new Matrix4().makeRotationY(Math.PI / 3);
    q.setFromRotationMatrix(m, out);
    expect(counter.count).toBe(0);
    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 3);
    expectSameRotation(out, expected);
  });

  test('result matches non-observable Quaternion', () => {
    const { observer } = makeObserver();
    const q = new ObservableQuaternion(observer);
    const ref = new Quaternion();
    const m = new Matrix4().makeRotationX(Math.PI / 5);
    q.setFromRotationMatrix(m);
    ref.setFromRotationMatrix(m);
    expectQuatClose(q, ref.x, ref.y, ref.z, ref.w);
  });

  test('identity matrix starting from identity does not fire observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.setFromRotationMatrix(new Matrix4());
    expect(counter.count).toBe(0);
  });
});

describe('ObservableQuaternion.setFromScaledRotationMatrix', () => {
  test('fires observer once on real change', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 3);
    const m = new Matrix4().compose({ x: 0, y: 0, z: 0 }, expected, { x: 2, y: 3, z: 4 });
    q.setFromScaledRotationMatrix(m);
    expect(counter.count).toBe(1);
    expectSameRotation(q, expected);
  });

  test('writes into out without firing observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 3);
    const m = new Matrix4().compose({ x: 0, y: 0, z: 0 }, expected, { x: 2, y: 3, z: 4 });
    q.setFromScaledRotationMatrix(m, out);
    expect(counter.count).toBe(0);
    expectSameRotation(out, expected);
  });

  test('result matches non-observable Quaternion', () => {
    const { observer } = makeObserver();
    const q = new ObservableQuaternion(observer);
    const ref = new Quaternion();
    const target = new Quaternion().setFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 4);
    const m = new Matrix4().compose({ x: 5, y: 6, z: 7 }, target, { x: 1.5, y: 2.5, z: 3.5 });
    q.setFromScaledRotationMatrix(m);
    ref.setFromScaledRotationMatrix(m);
    expectQuatClose(q, ref.x, ref.y, ref.z, ref.w);
  });
});

describe('ObservableQuaternion.setFromUnitVectors', () => {
  test('fires observer once on real change', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.setFromUnitVectors({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(counter.count).toBe(1);
    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2);
    expectSameRotation(q, expected);
  });

  test('parallel vectors starting from identity do not fire observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.setFromUnitVectors({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(counter.count).toBe(0);
  });

  test('writes into out without firing observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    q.setFromUnitVectors({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, out);
    expect(counter.count).toBe(0);
    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2);
    expectSameRotation(out, expected);
  });

  test('result matches non-observable Quaternion', () => {
    const { observer } = makeObserver();
    const q = new ObservableQuaternion(observer);
    const ref = new Quaternion();
    q.setFromUnitVectors({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    ref.setFromUnitVectors({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    expectQuatClose(q, ref.x, ref.y, ref.z, ref.w);
  });
});

describe('ObservableQuaternion — read-only math methods', () => {
  test('dot does not fire observer and matches Quaternion', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    const ref = new Quaternion(0.1, 0.2, 0.3, 0.4);
    const other = { x: 0.5, y: 0.6, z: 0.7, w: 0.8 };
    expect(q.dot(other)).toBeCloseTo(ref.dot(other), 5);
    expect(counter.count).toBe(0);
  });

  test('angleTo does not fire observer and matches Quaternion', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0);
    counter.count = 0;

    const target = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 3);
    expect(q.angleTo(target)).toBeCloseTo(Math.PI / 3, 5);
    expect(counter.count).toBe(0);
  });

  test('magnitude does not fire observer and matches Quaternion', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 1, 1, 1, 1);
    expect(q.magnitude()).toBeCloseTo(2, 5);
    expect(counter.count).toBe(0);
  });

  test('magnitudeSquared does not fire observer and matches Quaternion', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 1, 1, 1, 1);
    expect(q.magnitudeSquared()).toBeCloseTo(4, 5);
    expect(counter.count).toBe(0);
  });

  test('toString does not fire observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    expect(q.toString()).toContain('ObservableQuaternion');
    expect(q.toString()).toContain('0.1');
    expect(counter.count).toBe(0);
  });

  test('toArray does not fire observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    const arr = q.toArray();
    expect(arr[0]).toBeCloseTo(0.1, 5);
    expect(arr[3]).toBeCloseTo(0.4, 5);
    expect(counter.count).toBe(0);
  });

  test('toArray writes into supplied array at offset without firing observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    const arr = [0, 0, 0, 0, 0, 0];
    q.toArray(arr, 2);
    expect(arr[2]).toBeCloseTo(0.1, 5);
    expect(arr[5]).toBeCloseTo(0.4, 5);
    expect(counter.count).toBe(0);
  });
});

describe('ObservableQuaternion.normalize', () => {
  test('fires observer once on real change (in-place)', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 2, 0, 0, 0);
    q.normalize();
    expect(counter.count).toBe(1);
    expectQuatClose(q, 1, 0, 0, 0);
  });

  test('zero quaternion becomes identity', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0, 0, 0, 0);
    q.normalize();
    expect(counter.count).toBe(1);
    expectQuatClose(q, 0, 0, 0, 1);
  });

  test('writes into out without firing observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 2, 0, 0, 0);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    q.normalize(out);
    expect(counter.count).toBe(0);
    expectQuatClose(out, 1, 0, 0, 0);
    expectQuatClose(q, 2, 0, 0, 0);
  });

  test('already-unit quaternion does not fire observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.normalize();
    expect(counter.count).toBe(0);
  });
});

describe('ObservableQuaternion.inverse and conjugate', () => {
  test('conjugate fires observer once on real change', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    q.conjugate();
    expect(counter.count).toBe(1);
    expectQuatClose(q, -0.1, -0.2, -0.3, 0.4);
  });

  test('conjugate of identity does not fire observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.conjugate();
    expect(counter.count).toBe(0);
  });

  test('inverse fires observer once on real change', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    q.inverse();
    expect(counter.count).toBe(1);
    expectQuatClose(q, -0.1, -0.2, -0.3, 0.4);
  });

  test('conjugate writes into out without firing observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    q.conjugate(out);
    expect(counter.count).toBe(0);
    expectQuatClose(out, -0.1, -0.2, -0.3, 0.4);
    expectQuatClose(q, 0.1, 0.2, 0.3, 0.4);
  });
});

describe('ObservableQuaternion.multiply and premultiply', () => {
  test('multiply fires observer once on real change', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.setFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 4);
    counter.count = 0;

    q.multiply(new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 4));
    expect(counter.count).toBe(1);
  });

  test('multiply by identity starting from identity does not fire observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.multiply(new Quaternion());
    expect(counter.count).toBe(0);
  });

  test('multiply matches non-observable Quaternion', () => {
    const { observer } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    const ref = new Quaternion(0.1, 0.2, 0.3, 0.4);
    const other = new Quaternion(0.5, 0.6, 0.7, 0.8);
    q.multiply(other);
    ref.multiply(other);
    expectQuatClose(q, ref.x, ref.y, ref.z, ref.w);
  });

  test('premultiply fires observer once on real change', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.setFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 4);
    counter.count = 0;

    q.premultiply(new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 4));
    expect(counter.count).toBe(1);
  });

  test('premultiply matches non-observable Quaternion', () => {
    const { observer } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    const ref = new Quaternion(0.1, 0.2, 0.3, 0.4);
    const other = new Quaternion(0.5, 0.6, 0.7, 0.8);
    q.premultiply(other);
    ref.premultiply(other);
    expectQuatClose(q, ref.x, ref.y, ref.z, ref.w);
  });

  test('multiply writes into out without firing observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    const other = new Quaternion(0.5, 0.6, 0.7, 0.8);
    q.multiply(other, out);
    expect(counter.count).toBe(0);
    expectQuatClose(q, 0.1, 0.2, 0.3, 0.4);

    const expected = new Quaternion(0.1, 0.2, 0.3, 0.4).multiply(other);
    expectQuatClose(out, expected.x, expected.y, expected.z, expected.w);
  });

  test('premultiply writes into out without firing observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    const other = new Quaternion(0.5, 0.6, 0.7, 0.8);
    q.premultiply(other, out);
    expect(counter.count).toBe(0);
    expectQuatClose(q, 0.1, 0.2, 0.3, 0.4);

    const expected = new Quaternion(0.1, 0.2, 0.3, 0.4).premultiply(other);
    expectQuatClose(out, expected.x, expected.y, expected.z, expected.w);
  });
});

describe('ObservableQuaternion.slerp', () => {
  test('fires observer once on real change', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0);
    counter.count = 0;

    const target = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    q.slerp(target, 0.5);
    expect(counter.count).toBe(1);

    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 4);
    expectSameRotation(q, expected);
  });

  test('matches non-observable Quaternion', () => {
    const { observer } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0);
    const ref = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0);

    const target = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    q.slerp(target, 0.3);
    ref.slerp(target, 0.3);
    expectQuatClose(q, ref.x, ref.y, ref.z, ref.w);
  });

  test('writes into out without firing observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0);
    counter.count = 0;

    const target = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const out: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 0 };
    q.slerp(target, 0.5, out);
    expect(counter.count).toBe(0);

    const expected = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 4);
    expectSameRotation(out, expected);
  });
});

describe('ObservableQuaternion.fromArray and toArray', () => {
  test('fromArray fires observer once on real change', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.fromArray([0.1, 0.2, 0.3, 0.4]);
    expect(counter.count).toBe(1);
    expectQuatClose(q, 0.1, 0.2, 0.3, 0.4);
  });

  test('fromArray respects offset', () => {
    const { observer } = makeObserver();
    const q = new ObservableQuaternion(observer);
    q.fromArray([9, 9, 0.1, 0.2, 0.3, 0.4], 2);
    expectQuatClose(q, 0.1, 0.2, 0.3, 0.4);
  });

  test('fromArray with identical values does not fire observer', () => {
    const { observer, counter } = makeObserver();
    const q = new ObservableQuaternion(observer, 0.1, 0.2, 0.3, 0.4);
    q.fromArray([0.1, 0.2, 0.3, 0.4]);
    expect(counter.count).toBe(0);
  });
});
