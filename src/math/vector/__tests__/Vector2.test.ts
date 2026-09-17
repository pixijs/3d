import { describe, expect, test } from 'vitest';

import { Matrix3 } from '~/math/matrix/Matrix3';
import { Vector2 } from '~/math/vector/Vector2';

describe('Vector2', () => {
  describe('fromArray / toArray', () => {
    test('fromArray reads x, y from offset 0 by default', () => {
      const p = new Vector2();
      p.fromArray([3, 4]);

      expect(p.x).toBe(3);
      expect(p.y).toBe(4);
    });

    test('fromArray honors a non-zero offset', () => {
      const p = new Vector2();
      p.fromArray([99, 99, 5, 6, 99], 2);

      expect(p.x).toBe(5);
      expect(p.y).toBe(6);
    });

    test('fromArray returns this for chaining', () => {
      const p = new Vector2();
      const result = p.fromArray([1, 2]);

      expect(result).toBe(p);
    });

    test('fromArray works with a Float32Array source', () => {
      const p = new Vector2();
      p.fromArray(new Float32Array([7, 8]));

      expect(p.x).toBe(7);
      expect(p.y).toBe(8);
    });

    test('toArray allocates a new array when not supplied', () => {
      const p = new Vector2(2, 3);
      const arr = p.toArray();

      expect(arr).toEqual([2, 3]);
    });

    test('toArray writes into a supplied array at offset 0', () => {
      const p = new Vector2(2, 3);
      const arr: number[] = [];
      const result = p.toArray(arr);

      expect(result).toBe(arr);
      expect(arr).toEqual([2, 3]);
    });

    test('toArray writes into a supplied array at a non-zero offset', () => {
      const p = new Vector2(2, 3);
      const arr = [0, 0, 0, 0];
      p.toArray(arr, 2);

      expect(arr).toEqual([0, 0, 2, 3]);
    });

    test('toArray works with a Float32Array destination', () => {
      const p = new Vector2(1.5, 2.5);
      const f32 = new Float32Array(2);
      p.toArray(f32);

      expect(f32[0]).toBeCloseTo(1.5, 6);
      expect(f32[1]).toBeCloseTo(2.5, 6);
    });
  });

  describe('add', () => {
    test('mutates this when no out is supplied', () => {
      const p = new Vector2(1, 2);
      const result = p.add({ x: 3, y: 4 });

      expect(result).toBe(p);
      expect(p.x).toBe(4);
      expect(p.y).toBe(6);
    });

    test('writes into out without mutating this', () => {
      const p = new Vector2(1, 2);
      const out = new Vector2();
      const result = p.add({ x: 3, y: 4 }, out);

      expect(result).toBe(out);
      expect(out.x).toBe(4);
      expect(out.y).toBe(6);
      expect(p.x).toBe(1);
      expect(p.y).toBe(2);
    });
  });

  describe('subtract', () => {
    test('mutating-default subtracts componentwise', () => {
      const p = new Vector2(5, 7);
      p.subtract({ x: 3, y: 2 });

      expect(p.x).toBe(2);
      expect(p.y).toBe(5);
    });

    test('out variant leaves this unchanged', () => {
      const p = new Vector2(5, 7);
      const out = new Vector2();
      p.subtract({ x: 3, y: 2 }, out);

      expect(out.x).toBe(2);
      expect(out.y).toBe(5);
      expect(p.x).toBe(5);
      expect(p.y).toBe(7);
    });
  });

  describe('multiply', () => {
    test('mutating-default multiplies componentwise', () => {
      const p = new Vector2(2, 3);
      p.multiply({ x: 4, y: 5 });

      expect(p.x).toBe(8);
      expect(p.y).toBe(15);
    });

    test('out variant leaves this unchanged', () => {
      const p = new Vector2(2, 3);
      const out = new Vector2();
      p.multiply({ x: 4, y: 5 }, out);

      expect(out.x).toBe(8);
      expect(out.y).toBe(15);
      expect(p.x).toBe(2);
      expect(p.y).toBe(3);
    });
  });

  describe('multiplyScalar', () => {
    test('mutating-default multiplies each component by scalar', () => {
      const p = new Vector2(2, 3);
      p.multiplyScalar(4);

      expect(p.x).toBe(8);
      expect(p.y).toBe(12);
    });

    test('out variant leaves this unchanged', () => {
      const p = new Vector2(2, 3);
      const out = new Vector2();
      p.multiplyScalar(4, out);

      expect(out.x).toBe(8);
      expect(out.y).toBe(12);
      expect(p.x).toBe(2);
      expect(p.y).toBe(3);
    });
  });

  describe('divide', () => {
    test('mutating-default divides componentwise', () => {
      const p = new Vector2(8, 15);
      p.divide({ x: 2, y: 3 });

      expect(p.x).toBe(4);
      expect(p.y).toBe(5);
    });

    test('out variant leaves this unchanged', () => {
      const p = new Vector2(8, 15);
      const out = new Vector2();
      p.divide({ x: 2, y: 3 }, out);

      expect(out.x).toBe(4);
      expect(out.y).toBe(5);
      expect(p.x).toBe(8);
      expect(p.y).toBe(15);
    });
  });

  describe('divideScalar', () => {
    test('mutating-default divides each component by scalar', () => {
      const p = new Vector2(8, 12);
      p.divideScalar(4);

      expect(p.x).toBeCloseTo(2, 6);
      expect(p.y).toBeCloseTo(3, 6);
    });

    test('out variant leaves this unchanged', () => {
      const p = new Vector2(8, 12);
      const out = new Vector2();
      p.divideScalar(4, out);

      expect(out.x).toBeCloseTo(2, 6);
      expect(out.y).toBeCloseTo(3, 6);
      expect(p.x).toBe(8);
      expect(p.y).toBe(12);
    });
  });

  describe('addScaledVector', () => {
    test('mutating-default adds v * s to this', () => {
      const p = new Vector2(1, 2);
      p.addScaledVector({ x: 3, y: 4 }, 2);

      expect(p.x).toBe(7);
      expect(p.y).toBe(10);
    });

    test('out variant leaves this unchanged', () => {
      const p = new Vector2(1, 2);
      const out = new Vector2();
      p.addScaledVector({ x: 3, y: 4 }, 2, out);

      expect(out.x).toBe(7);
      expect(out.y).toBe(10);
      expect(p.x).toBe(1);
      expect(p.y).toBe(2);
    });
  });

  describe('negate', () => {
    test('mutating-default negates this', () => {
      const p = new Vector2(3, -5);
      p.negate();

      expect(p.x).toBe(-3);
      expect(p.y).toBe(5);
    });

    test('out variant leaves this unchanged', () => {
      const p = new Vector2(3, -5);
      const out = new Vector2();
      p.negate(out);

      expect(out.x).toBe(-3);
      expect(out.y).toBe(5);
      expect(p.x).toBe(3);
      expect(p.y).toBe(-5);
    });
  });

  describe('min', () => {
    test('mutating-default takes componentwise minimum', () => {
      const p = new Vector2(3, 7);
      p.min({ x: 5, y: 2 });

      expect(p.x).toBe(3);
      expect(p.y).toBe(2);
    });

    test('out variant leaves this unchanged', () => {
      const p = new Vector2(3, 7);
      const out = new Vector2();
      p.min({ x: 5, y: 2 }, out);

      expect(out.x).toBe(3);
      expect(out.y).toBe(2);
      expect(p.x).toBe(3);
      expect(p.y).toBe(7);
    });
  });

  describe('max', () => {
    test('mutating-default takes componentwise maximum', () => {
      const p = new Vector2(3, 7);
      p.max({ x: 5, y: 2 });

      expect(p.x).toBe(5);
      expect(p.y).toBe(7);
    });

    test('out variant leaves this unchanged', () => {
      const p = new Vector2(3, 7);
      const out = new Vector2();
      p.max({ x: 5, y: 2 }, out);

      expect(out.x).toBe(5);
      expect(out.y).toBe(7);
      expect(p.x).toBe(3);
      expect(p.y).toBe(7);
    });
  });

  describe('clamp', () => {
    test('mutating-default clamps componentwise within min/max', () => {
      const p = new Vector2(-3, 12);
      p.clamp({ x: 0, y: 0 }, { x: 10, y: 10 });

      expect(p.x).toBe(0);
      expect(p.y).toBe(10);
    });

    test('values within range are unchanged', () => {
      const p = new Vector2(5, 5);
      p.clamp({ x: 0, y: 0 }, { x: 10, y: 10 });

      expect(p.x).toBe(5);
      expect(p.y).toBe(5);
    });

    test('out variant leaves this unchanged', () => {
      const p = new Vector2(-3, 12);
      const out = new Vector2();
      p.clamp({ x: 0, y: 0 }, { x: 10, y: 10 }, out);

      expect(out.x).toBe(0);
      expect(out.y).toBe(10);
      expect(p.x).toBe(-3);
      expect(p.y).toBe(12);
    });
  });

  describe('normalize', () => {
    test('mutating-default produces a unit-length vector', () => {
      const p = new Vector2(3, 4);
      p.normalize();

      expect(p.x).toBeCloseTo(0.6, 6);
      expect(p.y).toBeCloseTo(0.8, 6);
      expect(Math.sqrt(p.x * p.x + p.y * p.y)).toBeCloseTo(1, 6);
    });

    test('out variant leaves this unchanged', () => {
      const p = new Vector2(3, 4);
      const out = new Vector2();
      p.normalize(out);

      expect(out.x).toBeCloseTo(0.6, 6);
      expect(out.y).toBeCloseTo(0.8, 6);
      expect(p.x).toBe(3);
      expect(p.y).toBe(4);
    });

    test('zero-magnitude vector is left at (0, 0) (length-1 fallback divides 0 by 1)', () => {
      const p = new Vector2(0, 0);
      p.normalize();

      expect(p.x).toBe(0);
      expect(p.y).toBe(0);
    });
  });

  describe('setLength', () => {
    test('mutating-default rescales to the requested length', () => {
      const p = new Vector2(3, 4);
      p.setLength(10);

      expect(p.x).toBeCloseTo(6, 6);
      expect(p.y).toBeCloseTo(8, 6);
      expect(Math.sqrt(p.x * p.x + p.y * p.y)).toBeCloseTo(10, 6);
    });

    test('out variant leaves this unchanged', () => {
      const p = new Vector2(3, 4);
      const out = new Vector2();
      p.setLength(10, out);

      expect(out.x).toBeCloseTo(6, 6);
      expect(out.y).toBeCloseTo(8, 6);
      expect(p.x).toBe(3);
      expect(p.y).toBe(4);
    });

    test('zero-magnitude vector remains (0, 0) regardless of requested length', () => {
      const p = new Vector2(0, 0);
      p.setLength(5);

      expect(p.x).toBe(0);
      expect(p.y).toBe(0);
    });
  });

  describe('magnitude / magnitudeSquared', () => {
    test('magnitude returns the Euclidean length', () => {
      expect(new Vector2(3, 4).magnitude()).toBeCloseTo(5, 6);
      expect(new Vector2(0, 0).magnitude()).toBe(0);
      expect(new Vector2(-3, -4).magnitude()).toBeCloseTo(5, 6);
    });

    test('magnitudeSquared returns the squared Euclidean length', () => {
      expect(new Vector2(3, 4).magnitudeSquared()).toBe(25);
      expect(new Vector2(0, 0).magnitudeSquared()).toBe(0);
    });
  });

  describe('distanceTo / distanceToSquared', () => {
    test('distanceTo returns Euclidean distance', () => {
      const a = new Vector2(1, 2);
      expect(a.distanceTo({ x: 4, y: 6 })).toBeCloseTo(5, 6);
    });

    test('distanceTo to itself is 0', () => {
      const a = new Vector2(7, -3);
      expect(a.distanceTo({ x: 7, y: -3 })).toBe(0);
    });

    test('distanceToSquared returns squared Euclidean distance', () => {
      const a = new Vector2(1, 2);
      expect(a.distanceToSquared({ x: 4, y: 6 })).toBe(25);
    });
  });

  describe('dot', () => {
    test('returns sum of componentwise products', () => {
      expect(new Vector2(1, 2).dot({ x: 3, y: 4 })).toBe(11);
    });

    test('orthogonal vectors have zero dot product', () => {
      expect(new Vector2(1, 0).dot({ x: 0, y: 1 })).toBe(0);
    });
  });

  describe('angle', () => {
    test('returns 0 for vector along +x', () => {
      expect(new Vector2(1, 0).angle()).toBeCloseTo(0, 6);
    });

    test('returns PI/2 for vector along +y', () => {
      expect(new Vector2(0, 1).angle()).toBeCloseTo(Math.PI / 2, 6);
    });

    test('returns PI for vector along -x', () => {
      expect(new Vector2(-1, 0).angle()).toBeCloseTo(Math.PI, 6);
    });

    test('returns -PI/2 for vector along -y', () => {
      expect(new Vector2(0, -1).angle()).toBeCloseTo(-Math.PI / 2, 6);
    });
  });

  describe('cross', () => {
    test('returns 2D scalar cross product', () => {
      expect(new Vector2(1, 0).cross({ x: 0, y: 1 })).toBe(1);
      expect(new Vector2(0, 1).cross({ x: 1, y: 0 })).toBe(-1);
    });

    test('parallel vectors yield zero', () => {
      expect(new Vector2(2, 4).cross({ x: 1, y: 2 })).toBe(0);
    });
  });

  describe('applyMatrix3', () => {
    test('identity matrix leaves the point unchanged', () => {
      const p = new Vector2(2, 3);
      p.applyMatrix3(new Matrix3());

      expect(p.x).toBeCloseTo(2, 6);
      expect(p.y).toBeCloseTo(3, 6);
    });

    test('translation matrix translates the point (uses w = 1)', () => {
      const p = new Vector2(1, 1);
      const m = new Matrix3().translate(5, 7);
      p.applyMatrix3(m);

      expect(p.x).toBeCloseTo(6, 6);
      expect(p.y).toBeCloseTo(8, 6);
    });

    test('scale matrix scales the point', () => {
      const p = new Vector2(2, 3);
      const m = new Matrix3().scale(4, 5);
      p.applyMatrix3(m);

      expect(p.x).toBeCloseTo(8, 6);
      expect(p.y).toBeCloseTo(15, 6);
    });

    test('out variant leaves this unchanged', () => {
      const p = new Vector2(1, 1);
      const m = new Matrix3().translate(5, 7);
      const out = new Vector2();
      p.applyMatrix3(m, out);

      expect(out.x).toBeCloseTo(6, 6);
      expect(out.y).toBeCloseTo(8, 6);
      expect(p.x).toBe(1);
      expect(p.y).toBe(1);
    });
  });

  describe('rotate', () => {
    test('rotating (1, 0) by PI/2 yields (0, 1)', () => {
      const p = new Vector2(1, 0);
      p.rotate(Math.PI / 2);

      expect(p.x).toBeCloseTo(0, 6);
      expect(p.y).toBeCloseTo(1, 6);
    });

    test('rotating (1, 0) by PI yields (-1, 0)', () => {
      const p = new Vector2(1, 0);
      p.rotate(Math.PI);

      expect(p.x).toBeCloseTo(-1, 6);
      expect(p.y).toBeCloseTo(0, 6);
    });

    test('rotating by 0 leaves the point unchanged', () => {
      const p = new Vector2(3, 4);
      p.rotate(0);

      expect(p.x).toBeCloseTo(3, 6);
      expect(p.y).toBeCloseTo(4, 6);
    });

    test('out variant leaves this unchanged', () => {
      const p = new Vector2(1, 0);
      const out = new Vector2();
      p.rotate(Math.PI / 2, out);

      expect(out.x).toBeCloseTo(0, 6);
      expect(out.y).toBeCloseTo(1, 6);
      expect(p.x).toBe(1);
      expect(p.y).toBe(0);
    });
  });

  describe('rotateAround', () => {
    test('rotating around the origin matches rotate()', () => {
      const p = new Vector2(1, 0);
      p.rotateAround({ x: 0, y: 0 }, Math.PI / 2);

      expect(p.x).toBeCloseTo(0, 6);
      expect(p.y).toBeCloseTo(1, 6);
    });

    test('rotating a point on the center pivot leaves it in place', () => {
      const p = new Vector2(3, 4);
      p.rotateAround({ x: 3, y: 4 }, Math.PI);

      expect(p.x).toBeCloseTo(3, 6);
      expect(p.y).toBeCloseTo(4, 6);
    });

    test('rotating (2, 0) around (1, 0) by PI yields (0, 0)', () => {
      const p = new Vector2(2, 0);
      p.rotateAround({ x: 1, y: 0 }, Math.PI);

      expect(p.x).toBeCloseTo(0, 6);
      expect(p.y).toBeCloseTo(0, 6);
    });

    test('out variant leaves this unchanged', () => {
      const p = new Vector2(2, 0);
      const out = new Vector2();
      p.rotateAround({ x: 1, y: 0 }, Math.PI, out);

      expect(out.x).toBeCloseTo(0, 6);
      expect(out.y).toBeCloseTo(0, 6);
      expect(p.x).toBe(2);
      expect(p.y).toBe(0);
    });
  });
});
