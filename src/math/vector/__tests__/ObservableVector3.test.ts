import type { Observer } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import { Matrix3 } from '~/math/matrix/Matrix3';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { Quaternion } from '~/math/rotation/Quaternion';
import { Cylindrical } from '~/math/shapes/Cylindrical';
import { Spherical } from '~/math/shapes/Spherical';
import { ObservableVector3 } from '~/math/vector/ObservableVector3';
import { Vector3 } from '~/math/vector/Vector3';

function expectVec3Close(p: { x: number; y: number; z: number }, x: number, y: number, z: number) {
  expect(p.x).toBeCloseTo(x, 5);
  expect(p.y).toBeCloseTo(y, 5);
  expect(p.z).toBeCloseTo(z, 5);
}

interface Counter {
  observer: Observer<ObservableVector3>;
  count: number;
  last: ObservableVector3 | null;
  reset: () => void;
}

function makeCounter(): Counter {
  const c: Counter = {
    count: 0,
    last: null,
    observer: null as unknown as Observer<ObservableVector3>,
    reset() {
      c.count = 0;
      c.last = null;
    },
  };
  c.observer = {
    _onUpdate(p?: ObservableVector3) {
      c.count++;
      c.last = p ?? null;
    },
  };
  return c;
}

describe('ObservableVector3', () => {
  describe('constructor', () => {
    test('defaults to (0, 0, 0)', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer);
      expect(p.x).toBe(0);
      expect(p.y).toBe(0);
      expect(p.z).toBe(0);
    });

    test('does not fire observer on construction', () => {
      const c = makeCounter();
      new ObservableVector3(c.observer, 1, 2, 3);
      expect(c.count).toBe(0);
    });
  });

  describe('x setter', () => {
    test('fires observer once when value changes', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer);
      p.x = 5;
      expect(c.count).toBe(1);
      expect(c.last).toBe(p);
      expect(p.x).toBe(5);
    });

    test('does not fire when value is the same (no-op)', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer, 5, 0, 0);
      p.x = 5;
      expect(c.count).toBe(0);
    });
  });

  describe('y setter', () => {
    test('fires observer once when value changes', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer);
      p.y = 5;
      expect(c.count).toBe(1);
      expect(p.y).toBe(5);
    });

    test('does not fire when value is the same (no-op)', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer, 0, 5, 0);
      p.y = 5;
      expect(c.count).toBe(0);
    });
  });

  describe('z setter', () => {
    test('fires observer once when value changes', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer);
      p.z = 5;
      expect(c.count).toBe(1);
      expect(p.z).toBe(5);
    });

    test('does not fire when value is the same (no-op)', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer, 0, 0, 5);
      p.z = 5;
      expect(c.count).toBe(0);
    });
  });

  describe('set', () => {
    test('sets all three components', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer);
      p.set(1, 2, 3);
      expectVec3Close(p, 1, 2, 3);
    });

    test('y and z default to x when omitted', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer);
      p.set(7);
      expectVec3Close(p, 7, 7, 7);
    });

    test('default with no arguments produces (0, 0, 0)', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer, 9, 9, 9);
      p.set();
      expectVec3Close(p, 0, 0, 0);
    });

    test('fires observer once when any component differs', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer, 0, 0, 0);
      p.set(1, 2, 3);
      expect(c.count).toBe(1);
    });

    test('fires observer once when only one component differs', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer, 1, 2, 3);
      p.set(1, 2, 9);
      expect(c.count).toBe(1);
    });

    test('does not fire when all components match (no-op)', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer, 1, 2, 3);
      p.set(1, 2, 3);
      expect(c.count).toBe(0);
    });
  });

  describe('copyFrom', () => {
    test('copies all three components', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer);
      p.copyFrom({ x: 1, y: 2, z: 3 });
      expectVec3Close(p, 1, 2, 3);
    });

    test('fires observer once when any component differs', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer, 0, 0, 0);
      p.copyFrom({ x: 1, y: 2, z: 3 });
      expect(c.count).toBe(1);
    });

    test('does not fire when all components match (no-op)', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer, 1, 2, 3);
      p.copyFrom({ x: 1, y: 2, z: 3 });
      expect(c.count).toBe(0);
    });
  });

  describe('copyTo', () => {
    test('copies all three components into target', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer, 1, 2, 3);
      const target = new Vector3();
      p.copyTo(target);
      expectVec3Close(target, 1, 2, 3);
    });
  });

  describe('equals', () => {
    test('returns true when all components match exactly', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      expect(a.equals({ x: 1, y: 2, z: 3 })).toBe(true);
    });

    test('returns false when any component differs', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      expect(a.equals({ x: 9, y: 2, z: 3 })).toBe(false);
      expect(a.equals({ x: 1, y: 9, z: 3 })).toBe(false);
      expect(a.equals({ x: 1, y: 2, z: 9 })).toBe(false);
    });
  });

  describe('clone', () => {
    test('creates a new ObservableVector3 with the same components', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      const b = a.clone();
      expectVec3Close(b, 1, 2, 3);
      expect(b).toBeInstanceOf(ObservableVector3);
      expect(b).not.toBe(a);
    });

    test("reuses this point's observer by default", () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      const b = a.clone();
      b.x = 99;
      expect(c.count).toBe(1);
      expect(c.last).toBe(b);
    });

    test("explicit observer overrides this point's observer", () => {
      const a_obs = makeCounter();
      const b_obs = makeCounter();
      const a = new ObservableVector3(a_obs.observer, 1, 2, 3);
      const b = a.clone(b_obs.observer);
      b.x = 99;
      expect(a_obs.count).toBe(0);
      expect(b_obs.count).toBe(1);
      expect(b_obs.last).toBe(b);
    });
  });

  describe('toString', () => {
    test('produces the labeled representation', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer, 1, 2, 3);
      expect(p.toString()).toBe('[pixi-3d/math:ObservableVector3 x=1 y=2 z=3]');
    });
  });

  describe('fromArray', () => {
    test('reads three values starting at offset 0 by default', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer);
      p.fromArray([10, 20, 30]);
      expectVec3Close(p, 10, 20, 30);
    });

    test('reads three values starting at supplied offset', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer);
      p.fromArray([0, 0, 1, 2, 3], 2);
      expectVec3Close(p, 1, 2, 3);
    });

    test('fires observer at most once', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer, 0, 0, 0);
      p.fromArray([1, 2, 3]);
      expect(c.count).toBe(1);
    });

    test('does not fire when values match current (no-op)', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer, 1, 2, 3);
      p.fromArray([1, 2, 3]);
      expect(c.count).toBe(0);
    });
  });

  describe('toArray', () => {
    test('writes three values into a new array by default', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer, 1, 2, 3);
      expect(p.toArray()).toEqual([1, 2, 3]);
    });

    test('writes at supplied offset', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer, 1, 2, 3);
      const arr = [9, 9, 9, 9, 9];
      p.toArray(arr, 2);
      expect(arr).toEqual([9, 9, 1, 2, 3]);
    });
  });

  describe('add', () => {
    test('mutates this and fires observer once', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      a.add({ x: 10, y: 20, z: 30 });
      expectVec3Close(a, 11, 22, 33);
      expect(c.count).toBe(1);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      const out = new Vector3();
      a.add({ x: 10, y: 20, z: 30 }, out);
      expectVec3Close(a, 1, 2, 3);
      expectVec3Close(out, 11, 22, 33);
      expect(c.count).toBe(0);
    });
  });

  describe('subtract', () => {
    test('mutates this and fires observer once', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 10, 20, 30);
      a.subtract({ x: 1, y: 2, z: 3 });
      expectVec3Close(a, 9, 18, 27);
      expect(c.count).toBe(1);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 10, 20, 30);
      const out = new Vector3();
      a.subtract({ x: 1, y: 2, z: 3 }, out);
      expectVec3Close(a, 10, 20, 30);
      expectVec3Close(out, 9, 18, 27);
      expect(c.count).toBe(0);
    });
  });

  describe('multiply', () => {
    test('component-wise multiplies and fires observer once', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      a.multiply({ x: 2, y: 3, z: 4 });
      expectVec3Close(a, 2, 6, 12);
      expect(c.count).toBe(1);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      const out = new Vector3();
      a.multiply({ x: 2, y: 3, z: 4 }, out);
      expectVec3Close(a, 1, 2, 3);
      expectVec3Close(out, 2, 6, 12);
      expect(c.count).toBe(0);
    });
  });

  describe('multiplyScalar', () => {
    test('multiplies each component by scalar and fires observer once', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      a.multiplyScalar(3);
      expectVec3Close(a, 3, 6, 9);
      expect(c.count).toBe(1);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      const out = new Vector3();
      a.multiplyScalar(2, out);
      expectVec3Close(a, 1, 2, 3);
      expectVec3Close(out, 2, 4, 6);
      expect(c.count).toBe(0);
    });
  });

  describe('divide', () => {
    test('component-wise divides and fires observer once', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 10, 20, 30);
      a.divide({ x: 2, y: 4, z: 5 });
      expectVec3Close(a, 5, 5, 6);
      expect(c.count).toBe(1);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 10, 20, 30);
      const out = new Vector3();
      a.divide({ x: 2, y: 4, z: 5 }, out);
      expectVec3Close(a, 10, 20, 30);
      expectVec3Close(out, 5, 5, 6);
      expect(c.count).toBe(0);
    });
  });

  describe('divideScalar', () => {
    test('divides each component by scalar and fires observer once', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 2, 4, 6);
      a.divideScalar(2);
      expectVec3Close(a, 1, 2, 3);
      expect(c.count).toBe(1);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 2, 4, 6);
      const out = new Vector3();
      a.divideScalar(2, out);
      expectVec3Close(a, 2, 4, 6);
      expectVec3Close(out, 1, 2, 3);
      expect(c.count).toBe(0);
    });
  });

  describe('addScaledVector', () => {
    test('adds v * s in place and fires observer once', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      a.addScaledVector({ x: 10, y: 20, z: 30 }, 2);
      expectVec3Close(a, 21, 42, 63);
      expect(c.count).toBe(1);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      const out = new Vector3();
      a.addScaledVector({ x: 10, y: 20, z: 30 }, 2, out);
      expectVec3Close(a, 1, 2, 3);
      expectVec3Close(out, 21, 42, 63);
      expect(c.count).toBe(0);
    });
  });

  describe('negate', () => {
    test('negates all components and fires observer once', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, -2, 3);
      a.negate();
      expectVec3Close(a, -1, 2, -3);
      expect(c.count).toBe(1);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      const out = new Vector3();
      a.negate(out);
      expectVec3Close(a, 1, 2, 3);
      expectVec3Close(out, -1, -2, -3);
      expect(c.count).toBe(0);
    });
  });

  describe('min', () => {
    test('component-wise minimum and fires observer once', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 5, 3);
      a.min({ x: 4, y: 2, z: 6 });
      expectVec3Close(a, 1, 2, 3);
      expect(c.count).toBe(1);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 5, 3);
      const out = new Vector3();
      a.min({ x: 4, y: 2, z: 6 }, out);
      expectVec3Close(a, 1, 5, 3);
      expectVec3Close(out, 1, 2, 3);
      expect(c.count).toBe(0);
    });
  });

  describe('max', () => {
    test('component-wise maximum and fires observer once', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 5, 3);
      a.max({ x: 4, y: 2, z: 6 });
      expectVec3Close(a, 4, 5, 6);
      expect(c.count).toBe(1);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 5, 3);
      const out = new Vector3();
      a.max({ x: 4, y: 2, z: 6 }, out);
      expectVec3Close(a, 1, 5, 3);
      expectVec3Close(out, 4, 5, 6);
      expect(c.count).toBe(0);
    });
  });

  describe('clamp', () => {
    test('clamps each component and fires observer once', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, -1, 5, 11);
      a.clamp({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 });
      expectVec3Close(a, 0, 5, 10);
      expect(c.count).toBe(1);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, -1, 5, 11);
      const out = new Vector3();
      a.clamp({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 }, out);
      expectVec3Close(a, -1, 5, 11);
      expectVec3Close(out, 0, 5, 10);
      expect(c.count).toBe(0);
    });
  });

  describe('normalize', () => {
    test('produces unit length and fires observer once', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 2, 0, 0);
      a.normalize();
      expectVec3Close(a, 1, 0, 0);
      expect(a.magnitude()).toBeCloseTo(1, 5);
      expect(c.count).toBe(1);
    });

    test('zero-magnitude point is left unchanged and the observer stays silent', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 0, 0, 0);
      a.normalize();
      expectVec3Close(a, 0, 0, 0);
      expect(c.count).toBe(0);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 2, 0, 0);
      const out = new Vector3();
      a.normalize(out);
      expectVec3Close(a, 2, 0, 0);
      expectVec3Close(out, 1, 0, 0);
      expect(c.count).toBe(0);
    });
  });

  describe('setLength', () => {
    test('rescales magnitude to the given length and fires observer once', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 0, 2, 0);
      a.setLength(5);
      expectVec3Close(a, 0, 5, 0);
      expect(a.magnitude()).toBeCloseTo(5, 5);
      expect(c.count).toBe(1);
    });

    test('zero-magnitude point is left unchanged', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 0, 0, 0);
      a.setLength(5);
      expectVec3Close(a, 0, 0, 0);
      expect(c.count).toBe(0);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 0, 2, 0);
      const out = new Vector3();
      a.setLength(10, out);
      expectVec3Close(a, 0, 2, 0);
      expectVec3Close(out, 0, 10, 0);
      expect(c.count).toBe(0);
    });
  });

  describe('magnitude', () => {
    test('returns sqrt of sum of squares', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer, 1, 2, 2);
      expect(p.magnitude()).toBeCloseTo(3, 5);
    });
  });

  describe('magnitudeSquared', () => {
    test('returns sum of squares', () => {
      const c = makeCounter();
      const p = new ObservableVector3(c.observer, 1, 2, 3);
      expect(p.magnitudeSquared()).toBe(1 + 4 + 9);
    });
  });

  describe('distanceTo', () => {
    test('returns the Euclidean distance', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 0, 0, 0);
      expect(a.distanceTo({ x: 1, y: 2, z: 2 })).toBeCloseTo(3, 5);
    });
  });

  describe('distanceToSquared', () => {
    test('returns the squared distance', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 0, 0, 0);
      expect(a.distanceToSquared({ x: 1, y: 2, z: 3 })).toBe(1 + 4 + 9);
    });
  });

  describe('dot', () => {
    test('returns the dot product', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      expect(a.dot({ x: 4, y: 5, z: 6 })).toBe(4 + 10 + 18);
    });
  });

  describe('angleTo', () => {
    test('returns 0 for parallel vectors', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 0, 0);
      expect(a.angleTo({ x: 2, y: 0, z: 0 })).toBeCloseTo(0, 5);
    });

    test('returns PI/2 for orthogonal vectors', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 0, 0);
      expect(a.angleTo({ x: 0, y: 1, z: 0 })).toBeCloseTo(Math.PI / 2, 5);
    });

    test('returns PI for antiparallel vectors', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 0, 0);
      expect(a.angleTo({ x: -1, y: 0, z: 0 })).toBeCloseTo(Math.PI, 5);
    });

    test('returns PI/2 when this has zero magnitude', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 0, 0, 0);
      expect(a.angleTo({ x: 1, y: 0, z: 0 })).toBe(Math.PI / 2);
    });
  });

  describe('cross', () => {
    test('computes the 3D cross product and fires observer once', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 0, 0);
      a.cross({ x: 0, y: 1, z: 0 });
      expectVec3Close(a, 0, 0, 1);
      expect(c.count).toBe(1);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 0, 0);
      const out = new Vector3();
      a.cross({ x: 0, y: 1, z: 0 }, out);
      expectVec3Close(a, 1, 0, 0);
      expectVec3Close(out, 0, 0, 1);
      expect(c.count).toBe(0);
    });
  });

  describe('applyMatrix3', () => {
    test('identity matrix leaves point unchanged and the observer stays silent', () => {
      const c = makeCounter();
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      a.applyMatrix3(new Matrix3());
      expectVec3Close(a, 1, 2, 3);
      expect(c.count).toBe(0);
    });

    test('scaled matrix scales components', () => {
      const c = makeCounter();
      const m = new Matrix3().set(2, 0, 0, 0, 3, 0, 0, 0, 4);
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      a.applyMatrix3(m);
      expectVec3Close(a, 2, 6, 12);
      expect(c.count).toBe(1);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const m = new Matrix3().set(2, 0, 0, 0, 3, 0, 0, 0, 4);
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      const out = new Vector3();
      a.applyMatrix3(m, out);
      expectVec3Close(a, 1, 2, 3);
      expectVec3Close(out, 2, 6, 12);
      expect(c.count).toBe(0);
    });
  });

  describe('applyMatrix4', () => {
    test('translation matrix translates the point (treats as position with w=1)', () => {
      const c = makeCounter();
      const m = new Matrix4().makeTranslation(10, 20, 30);
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      a.applyMatrix4(m);
      expectVec3Close(a, 11, 22, 33);
      expect(c.count).toBe(1);
    });

    test('rotation around Y rotates correctly', () => {
      const c = makeCounter();
      const m = new Matrix4().makeRotationY(Math.PI / 2);
      const a = new ObservableVector3(c.observer, 1, 0, 0);
      a.applyMatrix4(m);
      expectVec3Close(a, 0, 0, -1);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const m = new Matrix4().makeTranslation(10, 20, 30);
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      const out = new Vector3();
      a.applyMatrix4(m, out);
      expectVec3Close(a, 1, 2, 3);
      expectVec3Close(out, 11, 22, 33);
      expect(c.count).toBe(0);
    });
  });

  describe('applyAffineMatrix4', () => {
    test('translation matrix translates the point', () => {
      const c = makeCounter();
      const m = new Matrix4().makeTranslation(10, 20, 30);
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      a.applyAffineMatrix4(m);
      expectVec3Close(a, 11, 22, 33);
      expect(c.count).toBe(1);
    });

    test('matches applyMatrix4 for affine matrices', () => {
      const c = makeCounter();
      const m = new Matrix4()
        .makeRotationY(Math.PI / 3)
        .multiply(new Matrix4().makeTranslation(4, -5, 6))
        .multiply(new Matrix4().makeScale(2, 3, 4));

      const a = new ObservableVector3(c.observer, 1.5, -2.25, 0.75);
      const b = new ObservableVector3(c.observer, 1.5, -2.25, 0.75);
      a.applyMatrix4(m);
      b.applyAffineMatrix4(m);
      expectVec3Close(b, a.x, a.y, a.z);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const m = new Matrix4().makeTranslation(10, 20, 30);
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      const out = new Vector3();
      a.applyAffineMatrix4(m, out);
      expectVec3Close(a, 1, 2, 3);
      expectVec3Close(out, 11, 22, 33);
      expect(c.count).toBe(0);
    });
  });

  describe('applyQuaternion', () => {
    test('rotates the point by the unit quaternion', () => {
      const c = makeCounter();
      const q = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
      const a = new ObservableVector3(c.observer, 1, 0, 0);
      a.applyQuaternion(q);
      expectVec3Close(a, 0, 0, -1);
      expect(c.count).toBe(1);
    });

    test('identity quaternion leaves point unchanged', () => {
      const c = makeCounter();
      const q = new Quaternion();
      const a = new ObservableVector3(c.observer, 1, 2, 3);
      a.applyQuaternion(q);
      expectVec3Close(a, 1, 2, 3);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const q = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
      const a = new ObservableVector3(c.observer, 1, 0, 0);
      const out = new Vector3();
      a.applyQuaternion(q, out);
      expectVec3Close(a, 1, 0, 0);
      expectVec3Close(out, 0, 0, -1);
      expect(c.count).toBe(0);
    });
  });

  describe('transformDirection', () => {
    test('rotates a direction and ignores translation', () => {
      const c = makeCounter();
      const m = new Matrix4().makeRotationY(Math.PI / 2);
      m.elements[12] = 100;
      m.elements[13] = 200;
      m.elements[14] = 300;
      const a = new ObservableVector3(c.observer, 1, 0, 0);
      a.transformDirection(m);
      expectVec3Close(a, 0, 0, -1);
      expect(c.count).toBe(1);
    });

    test('result is normalized to unit length', () => {
      const c = makeCounter();
      const m = new Matrix4().makeScale(5, 5, 5);
      const a = new ObservableVector3(c.observer, 3, 0, 0);
      a.transformDirection(m);
      expect(a.magnitude()).toBeCloseTo(1, 5);
      expectVec3Close(a, 1, 0, 0);
    });

    test('writes into out without mutating this; observer not fired', () => {
      const c = makeCounter();
      const m = new Matrix4().makeRotationY(Math.PI / 2);
      const a = new ObservableVector3(c.observer, 1, 0, 0);
      const out = new Vector3();
      a.transformDirection(m, out);
      expectVec3Close(a, 1, 0, 0);
      expectVec3Close(out, 0, 0, -1);
      expect(c.count).toBe(0);
    });
  });

  describe('setFromSpherical', () => {
    test('Spherical(radius=1, phi=PI/2, theta=0) maps to (0, 0, 1)', () => {
      const c = makeCounter();
      const s = new Spherical(1, Math.PI / 2, 0);
      const p = new ObservableVector3(c.observer);
      p.setFromSpherical(s);
      expectVec3Close(p, 0, 0, 1);
      expect(c.count).toBe(1);
    });

    test('Spherical(radius=1, phi=PI/2, theta=PI/2) maps to (1, 0, 0)', () => {
      const c = makeCounter();
      const s = new Spherical(1, Math.PI / 2, Math.PI / 2);
      const p = new ObservableVector3(c.observer);
      p.setFromSpherical(s);
      expectVec3Close(p, 1, 0, 0);
    });

    test('Spherical(radius=1, phi=0) maps to +Y axis', () => {
      const c = makeCounter();
      const s = new Spherical(1, 0, 0);
      const p = new ObservableVector3(c.observer);
      p.setFromSpherical(s);
      expectVec3Close(p, 0, 1, 0);
    });
  });

  describe('setFromCylindrical', () => {
    test('Cylindrical(radius=1, theta=0, y=2) maps to (0, 2, 1)', () => {
      const c = makeCounter();
      const cyl = new Cylindrical(1, 0, 2);
      const p = new ObservableVector3(c.observer);
      p.setFromCylindrical(cyl);
      expectVec3Close(p, 0, 2, 1);
      expect(c.count).toBe(1);
    });

    test('Cylindrical(radius=1, theta=PI/2, y=0) maps to (1, 0, 0)', () => {
      const c = makeCounter();
      const cyl = new Cylindrical(1, Math.PI / 2, 0);
      const p = new ObservableVector3(c.observer);
      p.setFromCylindrical(cyl);
      expectVec3Close(p, 1, 0, 0);
    });
  });

  describe('setFromMatrixColumn', () => {
    test('reads the translation (10, 20, 30) from column 3', () => {
      const c = makeCounter();
      const m = new Matrix4().makeTranslation(10, 20, 30);
      const p = new ObservableVector3(c.observer);
      p.setFromMatrixColumn(m, 3);
      expect(p.x).toBeCloseTo(10, 5);
      expect(p.y).toBeCloseTo(20, 5);
      expect(p.z).toBeCloseTo(30, 5);
    });
  });
});
