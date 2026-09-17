import { describe, expect, test } from 'vitest';

import { Matrix4 } from '~/math/matrix/Matrix4';
import { Vector4 } from '~/math/vector/Vector4';

function expectVec4Close(
  p: { x: number; y: number; z: number; w: number },
  x: number,
  y: number,
  z: number,
  w: number,
) {
  expect(p.x).toBeCloseTo(x, 5);
  expect(p.y).toBeCloseTo(y, 5);
  expect(p.z).toBeCloseTo(z, 5);
  expect(p.w).toBeCloseTo(w, 5);
}

describe('Vector4', () => {
  describe('constructor', () => {
    test('defaults to (0, 0, 0, 1)', () => {
      const p = new Vector4();
      expect(p.x).toBe(0);
      expect(p.y).toBe(0);
      expect(p.z).toBe(0);
      expect(p.w).toBe(1);
    });

    test('respects supplied components', () => {
      const p = new Vector4(1, 2, 3, 4);
      expect(p.x).toBe(1);
      expect(p.y).toBe(2);
      expect(p.z).toBe(3);
      expect(p.w).toBe(4);
    });

    test('w defaults to 1 (not 0) when omitted', () => {
      const p = new Vector4(5, 6, 7);
      expect(p.w).toBe(1);
    });
  });

  describe('set', () => {
    test('sets all four components', () => {
      const p = new Vector4();
      p.set(1, 2, 3, 4);
      expectVec4Close(p, 1, 2, 3, 4);
    });

    test('y and z default to x when omitted', () => {
      const p = new Vector4();
      p.set(7);
      expectVec4Close(p, 7, 7, 7, 1);
    });

    test('w defaults to 1 always (not to x)', () => {
      const p = new Vector4();
      p.set(5);
      expect(p.w).toBe(1);
    });

    test('w defaults to 1 when only x, y, z are passed', () => {
      const p = new Vector4();
      p.set(2, 3, 4);
      expectVec4Close(p, 2, 3, 4, 1);
    });

    test('returns this', () => {
      const p = new Vector4();
      expect(p.set(1, 2, 3, 4)).toBe(p);
    });

    test('default with no arguments produces (0, 0, 0, 1)', () => {
      const p = new Vector4(9, 9, 9, 9);
      p.set();
      expectVec4Close(p, 0, 0, 0, 1);
    });
  });

  describe('copyFrom', () => {
    test('copies all four components', () => {
      const a = new Vector4(1, 2, 3, 0);
      const b = new Vector4();
      b.copyFrom(a);
      expectVec4Close(b, 1, 2, 3, 0);
    });

    test('returns this', () => {
      const a = new Vector4(1, 2, 3, 4);
      const b = new Vector4();
      expect(b.copyFrom(a)).toBe(b);
    });

    test('accepts plain PointData4D objects', () => {
      const p = new Vector4();
      p.copyFrom({ x: 5, y: 6, z: 7, w: 8 });
      expectVec4Close(p, 5, 6, 7, 8);
    });
  });

  describe('copyTo', () => {
    test('copies all four components into target', () => {
      const a = new Vector4(1, 2, 3, 4);
      const b = new Vector4();
      a.copyTo(b);
      expectVec4Close(b, 1, 2, 3, 4);
    });

    test('returns target', () => {
      const a = new Vector4(1, 2, 3, 4);
      const b = new Vector4();
      expect(a.copyTo(b)).toBe(b);
    });
  });

  describe('equals', () => {
    test('returns true when all four components match exactly', () => {
      const a = new Vector4(1, 2, 3, 4);
      const b = new Vector4(1, 2, 3, 4);
      expect(a.equals(b)).toBe(true);
    });

    test('returns false when any component differs', () => {
      const a = new Vector4(1, 2, 3, 4);
      expect(a.equals(new Vector4(9, 2, 3, 4))).toBe(false);
      expect(a.equals(new Vector4(1, 9, 3, 4))).toBe(false);
      expect(a.equals(new Vector4(1, 2, 9, 4))).toBe(false);
      expect(a.equals(new Vector4(1, 2, 3, 9))).toBe(false);
    });

    test('uses strict equality (no epsilon)', () => {
      const a = new Vector4(0.1 + 0.2, 0, 0, 1);
      const b = new Vector4(0.3, 0, 0, 1);
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('clone', () => {
    test('creates a new Vector4 with the same components', () => {
      const a = new Vector4(1, 2, 3, 4);
      const b = a.clone();
      expectVec4Close(b, 1, 2, 3, 4);
    });

    test('returns a new instance', () => {
      const a = new Vector4(1, 2, 3, 4);
      const b = a.clone();
      expect(b).not.toBe(a);
      expect(b).toBeInstanceOf(Vector4);
    });

    test('mutating the clone does not affect the original', () => {
      const a = new Vector4(1, 2, 3, 4);
      const b = a.clone();
      b.set(9, 9, 9, 9);
      expectVec4Close(a, 1, 2, 3, 4);
    });
  });

  describe('toString', () => {
    test('produces the labeled representation', () => {
      const p = new Vector4(1, 2, 3, 4);
      expect(p.toString()).toBe('[pixi-3d/math:Vector4 x=1 y=2 z=3 w=4]');
    });
  });

  describe('fromArray', () => {
    test('reads four values starting at offset 0 by default', () => {
      const p = new Vector4();
      p.fromArray([10, 20, 30, 40]);
      expectVec4Close(p, 10, 20, 30, 40);
    });

    test('reads four values starting at supplied offset', () => {
      const p = new Vector4();
      p.fromArray([0, 0, 1, 2, 3, 4], 2);
      expectVec4Close(p, 1, 2, 3, 4);
    });

    test('works with Float32Array', () => {
      const p = new Vector4();
      p.fromArray(new Float32Array([1, 2, 3, 4]));
      expectVec4Close(p, 1, 2, 3, 4);
    });

    test('returns this', () => {
      const p = new Vector4();
      expect(p.fromArray([1, 2, 3, 4])).toBe(p);
    });
  });

  describe('toArray', () => {
    test('writes four values into a new array by default', () => {
      const p = new Vector4(1, 2, 3, 4);
      const arr = p.toArray();
      expect(arr).toEqual([1, 2, 3, 4]);
    });

    test('writes into supplied array', () => {
      const p = new Vector4(1, 2, 3, 4);
      const arr = [0, 0, 0, 0];
      const result = p.toArray(arr);
      expect(result).toBe(arr);
      expect(arr).toEqual([1, 2, 3, 4]);
    });

    test('writes at supplied offset', () => {
      const p = new Vector4(1, 2, 3, 4);
      const arr = [9, 9, 9, 9, 9, 9];
      p.toArray(arr, 2);
      expect(arr).toEqual([9, 9, 1, 2, 3, 4]);
    });

    test('writes into supplied Float32Array', () => {
      const p = new Vector4(1, 2, 3, 4);
      const arr = new Float32Array(4);
      p.toArray(arr);
      expect(Array.from(arr)).toEqual([1, 2, 3, 4]);
    });
  });

  describe('add', () => {
    test('mutates this and adds across all four components', () => {
      const a = new Vector4(1, 2, 3, 4);
      const b = new Vector4(10, 20, 30, 40);
      a.add(b);
      expectVec4Close(a, 11, 22, 33, 44);
    });

    test('writes into out without mutating this', () => {
      const a = new Vector4(1, 2, 3, 4);
      const b = new Vector4(10, 20, 30, 40);
      const out = new Vector4();
      a.add(b, out);
      expectVec4Close(a, 1, 2, 3, 4);
      expectVec4Close(out, 11, 22, 33, 44);
    });
  });

  describe('subtract', () => {
    test('mutates this across all four components', () => {
      const a = new Vector4(10, 20, 30, 40);
      const b = new Vector4(1, 2, 3, 4);
      a.subtract(b);
      expectVec4Close(a, 9, 18, 27, 36);
    });

    test('writes into out without mutating this', () => {
      const a = new Vector4(10, 20, 30, 40);
      const b = new Vector4(1, 2, 3, 4);
      const out = new Vector4();
      a.subtract(b, out);
      expectVec4Close(a, 10, 20, 30, 40);
      expectVec4Close(out, 9, 18, 27, 36);
    });
  });

  describe('multiply', () => {
    test('component-wise multiplies across all four components', () => {
      const a = new Vector4(1, 2, 3, 4);
      const b = new Vector4(2, 3, 4, 5);
      a.multiply(b);
      expectVec4Close(a, 2, 6, 12, 20);
    });

    test('writes into out without mutating this', () => {
      const a = new Vector4(1, 2, 3, 4);
      const b = new Vector4(2, 3, 4, 5);
      const out = new Vector4();
      a.multiply(b, out);
      expectVec4Close(a, 1, 2, 3, 4);
      expectVec4Close(out, 2, 6, 12, 20);
    });
  });

  describe('multiplyScalar', () => {
    test('multiplies each component by scalar', () => {
      const a = new Vector4(1, 2, 3, 4);
      a.multiplyScalar(3);
      expectVec4Close(a, 3, 6, 9, 12);
    });

    test('writes into out without mutating this', () => {
      const a = new Vector4(1, 2, 3, 4);
      const out = new Vector4();
      a.multiplyScalar(2, out);
      expectVec4Close(a, 1, 2, 3, 4);
      expectVec4Close(out, 2, 4, 6, 8);
    });
  });

  describe('divide', () => {
    test('component-wise divides across all four components', () => {
      const a = new Vector4(10, 20, 30, 40);
      const b = new Vector4(2, 4, 5, 8);
      a.divide(b);
      expectVec4Close(a, 5, 5, 6, 5);
    });

    test('writes into out without mutating this', () => {
      const a = new Vector4(10, 20, 30, 40);
      const b = new Vector4(2, 4, 5, 8);
      const out = new Vector4();
      a.divide(b, out);
      expectVec4Close(a, 10, 20, 30, 40);
      expectVec4Close(out, 5, 5, 6, 5);
    });
  });

  describe('divideScalar', () => {
    test('divides each component by scalar', () => {
      const a = new Vector4(2, 4, 6, 8);
      a.divideScalar(2);
      expectVec4Close(a, 1, 2, 3, 4);
    });

    test('writes into out without mutating this', () => {
      const a = new Vector4(2, 4, 6, 8);
      const out = new Vector4();
      a.divideScalar(2, out);
      expectVec4Close(a, 2, 4, 6, 8);
      expectVec4Close(out, 1, 2, 3, 4);
    });
  });

  describe('addScaledVector', () => {
    test('adds v * s in place across all four components', () => {
      const a = new Vector4(1, 2, 3, 4);
      const v = new Vector4(10, 20, 30, 40);
      a.addScaledVector(v, 2);
      expectVec4Close(a, 21, 42, 63, 84);
    });

    test('writes into out without mutating this', () => {
      const a = new Vector4(1, 2, 3, 4);
      const v = new Vector4(10, 20, 30, 40);
      const out = new Vector4();
      a.addScaledVector(v, 2, out);
      expectVec4Close(a, 1, 2, 3, 4);
      expectVec4Close(out, 21, 42, 63, 84);
    });
  });

  describe('negate', () => {
    test('negates all four components', () => {
      const a = new Vector4(1, -2, 3, -4);
      a.negate();
      expectVec4Close(a, -1, 2, -3, 4);
    });

    test('writes into out without mutating this', () => {
      const a = new Vector4(1, 2, 3, 4);
      const out = new Vector4();
      a.negate(out);
      expectVec4Close(a, 1, 2, 3, 4);
      expectVec4Close(out, -1, -2, -3, -4);
    });
  });

  describe('min', () => {
    test('component-wise minimum across all four components', () => {
      const a = new Vector4(1, 5, 3, 8);
      const b = new Vector4(4, 2, 6, 1);
      a.min(b);
      expectVec4Close(a, 1, 2, 3, 1);
    });

    test('writes into out without mutating this', () => {
      const a = new Vector4(1, 5, 3, 8);
      const b = new Vector4(4, 2, 6, 1);
      const out = new Vector4();
      a.min(b, out);
      expectVec4Close(a, 1, 5, 3, 8);
      expectVec4Close(out, 1, 2, 3, 1);
    });
  });

  describe('max', () => {
    test('component-wise maximum across all four components', () => {
      const a = new Vector4(1, 5, 3, 8);
      const b = new Vector4(4, 2, 6, 1);
      a.max(b);
      expectVec4Close(a, 4, 5, 6, 8);
    });

    test('writes into out without mutating this', () => {
      const a = new Vector4(1, 5, 3, 8);
      const b = new Vector4(4, 2, 6, 1);
      const out = new Vector4();
      a.max(b, out);
      expectVec4Close(a, 1, 5, 3, 8);
      expectVec4Close(out, 4, 5, 6, 8);
    });
  });

  describe('clamp', () => {
    test('clamps each component to [min, max]', () => {
      const a = new Vector4(-1, 5, 11, 0.5);
      const min = new Vector4(0, 0, 0, 0);
      const max = new Vector4(10, 10, 10, 1);
      a.clamp(min, max);
      expectVec4Close(a, 0, 5, 10, 0.5);
    });

    test('writes into out without mutating this', () => {
      const a = new Vector4(-1, 5, 11, 0.5);
      const min = new Vector4(0, 0, 0, 0);
      const max = new Vector4(10, 10, 10, 1);
      const out = new Vector4();
      a.clamp(min, max, out);
      expectVec4Close(a, -1, 5, 11, 0.5);
      expectVec4Close(out, 0, 5, 10, 0.5);
    });
  });

  describe('normalize', () => {
    test('produces unit length across all four components', () => {
      const p = new Vector4(2, 0, 0, 0);
      p.normalize();
      expectVec4Close(p, 1, 0, 0, 0);
      expect(p.magnitude()).toBeCloseTo(1, 5);
    });

    test('normalizes a non-axis-aligned vector', () => {
      const p = new Vector4(1, 1, 1, 1);
      p.normalize();
      const expected = 0.5;
      expectVec4Close(p, expected, expected, expected, expected);
      expect(p.magnitude()).toBeCloseTo(1, 5);
    });

    test('zero-magnitude point is left unchanged', () => {
      const p = new Vector4(0, 0, 0, 0);
      p.normalize();
      expectVec4Close(p, 0, 0, 0, 0);
    });

    test('writes into out without mutating this', () => {
      const a = new Vector4(2, 0, 0, 0);
      const out = new Vector4();
      a.normalize(out);
      expectVec4Close(a, 2, 0, 0, 0);
      expectVec4Close(out, 1, 0, 0, 0);
    });
  });

  describe('setLength', () => {
    test('rescales magnitude to the given length', () => {
      const p = new Vector4(0, 2, 0, 0);
      p.setLength(5);
      expectVec4Close(p, 0, 5, 0, 0);
      expect(p.magnitude()).toBeCloseTo(5, 5);
    });

    test('zero-magnitude point is left unchanged', () => {
      const p = new Vector4(0, 0, 0, 0);
      p.setLength(5);
      expectVec4Close(p, 0, 0, 0, 0);
    });

    test('writes into out without mutating this', () => {
      const a = new Vector4(0, 2, 0, 0);
      const out = new Vector4();
      a.setLength(10, out);
      expectVec4Close(a, 0, 2, 0, 0);
      expectVec4Close(out, 0, 10, 0, 0);
    });
  });

  describe('magnitude', () => {
    test('returns sqrt of sum of squares across all four components', () => {
      const p = new Vector4(1, 2, 2, 0);
      expect(p.magnitude()).toBeCloseTo(3, 5);
    });

    test('includes the w component', () => {
      const p = new Vector4(0, 0, 0, 5);
      expect(p.magnitude()).toBeCloseTo(5, 5);
    });

    test('returns 0 for the origin', () => {
      const p = new Vector4(0, 0, 0, 0);
      expect(p.magnitude()).toBe(0);
    });
  });

  describe('magnitudeSquared', () => {
    test('returns sum of squares across all four components', () => {
      const p = new Vector4(1, 2, 3, 4);
      expect(p.magnitudeSquared()).toBe(1 + 4 + 9 + 16);
    });

    test('includes the w component', () => {
      const p = new Vector4(0, 0, 0, 5);
      expect(p.magnitudeSquared()).toBe(25);
    });
  });

  describe('distanceTo', () => {
    test('returns the Euclidean distance across all four components', () => {
      const a = new Vector4(0, 0, 0, 0);
      const b = new Vector4(1, 2, 2, 0);
      expect(a.distanceTo(b)).toBeCloseTo(3, 5);
    });

    test('includes the w component in the distance', () => {
      const a = new Vector4(0, 0, 0, 0);
      const b = new Vector4(0, 0, 0, 4);
      expect(a.distanceTo(b)).toBeCloseTo(4, 5);
    });

    test('returns 0 for identical points', () => {
      const a = new Vector4(1, 2, 3, 4);
      const b = new Vector4(1, 2, 3, 4);
      expect(a.distanceTo(b)).toBe(0);
    });
  });

  describe('distanceToSquared', () => {
    test('returns the squared distance across all four components', () => {
      const a = new Vector4(0, 0, 0, 0);
      const b = new Vector4(1, 2, 3, 4);
      expect(a.distanceToSquared(b)).toBe(1 + 4 + 9 + 16);
    });
  });

  describe('dot', () => {
    test('returns the dot product across all four components', () => {
      const a = new Vector4(1, 2, 3, 4);
      const b = new Vector4(5, 6, 7, 8);
      expect(a.dot(b)).toBe(5 + 12 + 21 + 32);
    });

    test('returns 0 for orthogonal vectors', () => {
      const a = new Vector4(1, 0, 0, 0);
      const b = new Vector4(0, 1, 0, 0);
      expect(a.dot(b)).toBe(0);
    });
  });

  describe('angleTo', () => {
    test('returns 0 for parallel vectors', () => {
      const a = new Vector4(1, 0, 0, 0);
      const b = new Vector4(2, 0, 0, 0);
      expect(a.angleTo(b)).toBeCloseTo(0, 5);
    });

    test('returns PI/2 for orthogonal vectors', () => {
      const a = new Vector4(1, 0, 0, 0);
      const b = new Vector4(0, 1, 0, 0);
      expect(a.angleTo(b)).toBeCloseTo(Math.PI / 2, 5);
    });

    test('returns PI for antiparallel vectors', () => {
      const a = new Vector4(1, 0, 0, 0);
      const b = new Vector4(-1, 0, 0, 0);
      expect(a.angleTo(b)).toBeCloseTo(Math.PI, 5);
    });

    test('returns PI/2 when this has zero magnitude', () => {
      const a = new Vector4(0, 0, 0, 0);
      const b = new Vector4(1, 0, 0, 0);
      expect(a.angleTo(b)).toBe(Math.PI / 2);
    });

    test('returns PI/2 when the other vector has zero magnitude', () => {
      const a = new Vector4(1, 0, 0, 0);
      const b = new Vector4(0, 0, 0, 0);
      expect(a.angleTo(b)).toBe(Math.PI / 2);
    });
  });

  describe('applyMatrix4', () => {
    test('identity matrix leaves all four components unchanged', () => {
      const m = new Matrix4();
      const p = new Vector4(1, 2, 3, 4);
      p.applyMatrix4(m);
      expectVec4Close(p, 1, 2, 3, 4);
    });

    test('w=1 picks up translation (homogeneous position)', () => {
      const m = new Matrix4().makeTranslation(10, 20, 30);
      const p = new Vector4(1, 2, 3, 1);
      p.applyMatrix4(m);
      expectVec4Close(p, 11, 22, 33, 1);
    });

    test('w=0 ignores translation (direction vector)', () => {
      const m = new Matrix4().makeTranslation(10, 20, 30);
      const p = new Vector4(1, 2, 3, 0);
      p.applyMatrix4(m);
      expectVec4Close(p, 1, 2, 3, 0);
    });

    test('does NOT perform the perspective divide; w is transformed', () => {
      const m = new Matrix4();
      m.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2);
      const p = new Vector4(1, 2, 3, 1);
      p.applyMatrix4(m);
      expect(p.x).toBeCloseTo(1, 5);
      expect(p.y).toBeCloseTo(2, 5);
      expect(p.z).toBeCloseTo(3, 5);
      expect(p.w).toBeCloseTo(2, 5);
    });

    test('rotation around Y rotates the x and z components', () => {
      const m = new Matrix4().makeRotationY(Math.PI / 2);
      const p = new Vector4(1, 0, 0, 1);
      p.applyMatrix4(m);
      expect(p.x).toBeCloseTo(0, 5);
      expect(p.y).toBeCloseTo(0, 5);
      expect(p.z).toBeCloseTo(-1, 5);
      expect(p.w).toBeCloseTo(1, 5);
    });

    test('writes into out without mutating this', () => {
      const m = new Matrix4().makeTranslation(10, 20, 30);
      const a = new Vector4(1, 2, 3, 1);
      const out = new Vector4();
      a.applyMatrix4(m, out);
      expectVec4Close(a, 1, 2, 3, 1);
      expectVec4Close(out, 11, 22, 33, 1);
    });
  });

  describe('Vector4.shared', () => {
    test('returns a Vector4 reset to (0, 0, 0, 1) on first access', () => {
      const p = Vector4.shared;
      expectVec4Close(p, 0, 0, 0, 1);
    });

    test('mutations are reset on next access (w resets to 1)', () => {
      const a = Vector4.shared;
      a.x = 99;
      a.y = 99;
      a.z = 99;
      a.w = 0;

      const b = Vector4.shared;
      expectVec4Close(b, 0, 0, 0, 1);
    });

    test('returns the same instance across accesses', () => {
      const a = Vector4.shared;
      const b = Vector4.shared;
      expect(a).toBe(b);
    });
  });
});
