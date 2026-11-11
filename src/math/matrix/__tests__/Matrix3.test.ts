import { Matrix } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import { Matrix3 } from '~/math/matrix/Matrix3';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { Vector2 } from '~/math/vector/Vector2';
import { Vector3 } from '~/math/vector/Vector3';

function expectMatrix3Equal(m: Matrix3, expectedColMajor: ArrayLike<number>): void {
  for (let i = 0; i < 9; i++) {
    expect(m.elements[i]).toBeCloseTo(expectedColMajor[i], 5);
  }
}

describe('Matrix3', () => {
  describe('constructor', () => {
    test('defaults to identity', () => {
      const m = new Matrix3();

      expectMatrix3Equal(m, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    });

    test('accepts a 9-element backing array', () => {
      const elements = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) as never;
      const m = new Matrix3(elements);

      expectMatrix3Equal(m, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(m.elements).toBe(elements);
    });
  });

  describe('static Matrix3.shared', () => {
    test('returns an identity matrix on each access', () => {
      const a = Matrix3.shared;
      a.set(2, 3, 4, 5, 6, 7, 8, 9, 10);

      const b = Matrix3.shared;
      expect(b.isIdentity()).toBe(true);
    });
  });

  describe('set', () => {
    test('writes row-major args into column-major storage', () => {
      const m = new Matrix3();
      m.set(1, 2, 3, 4, 5, 6, 7, 8, 9);

      expectMatrix3Equal(m, [1, 4, 7, 2, 5, 8, 3, 6, 9]);
    });
  });

  describe('identity', () => {
    test('resets matrix to identity', () => {
      const m = new Matrix3();
      m.set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      m.identity();

      expectMatrix3Equal(m, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    });
  });

  describe('isIdentity', () => {
    test('returns false for non-identity', () => {
      const m = new Matrix3().set(2, 0, 0, 0, 1, 0, 0, 0, 1);
      expect(m.isIdentity()).toBe(false);
    });
  });

  describe('copyFrom', () => {
    test('copies elements', () => {
      const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const b = new Matrix3();
      b.copyFrom(a);

      expectMatrix3Equal(b, [1, 4, 7, 2, 5, 8, 3, 6, 9]);
    });
  });

  describe('copyTo', () => {
    test('writes into target', () => {
      const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const b = new Matrix3();
      a.copyTo(b);

      expectMatrix3Equal(b, [1, 4, 7, 2, 5, 8, 3, 6, 9]);
    });
  });

  describe('equals', () => {
    test('false when any element differs', () => {
      const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const b = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 99);

      expect(a.equals(b)).toBe(false);
    });
  });

  describe('clone', () => {
    test('returns an independent copy', () => {
      const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const b = a.clone();

      expect(b).not.toBe(a);
      expect(b.equals(a)).toBe(true);

      b.set(0, 0, 0, 0, 0, 0, 0, 0, 0);
      expect(a.elements[0]).toBe(1);
    });
  });

  describe('fromArray', () => {
    test('honors offset', () => {
      const m = new Matrix3();
      m.fromArray([99, 99, 1, 2, 3, 4, 5, 6, 7, 8, 9], 2);

      expectMatrix3Equal(m, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });

  describe('toArray', () => {
    test('writes column-major by default', () => {
      const m = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const arr = m.toArray();

      expect(Array.from(arr)).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9]);
    });

    test('writes row-major when transpose is true', () => {
      const m = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const arr = m.toArray(true);

      expect(Array.from(arr)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    test('writes into provided out array', () => {
      const m = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const out = new Float32Array(9);
      const result = m.toArray(false, out);

      expect(result).toBe(out);
      expect(Array.from(out)).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9]);
    });
  });

  describe('multiply', () => {
    const aTimesBColumnMajor = [30, 84, 138, 24, 69, 114, 18, 54, 90];

    test('mutates this when no out is supplied', () => {
      const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const b = new Matrix3().set(9, 8, 7, 6, 5, 4, 3, 2, 1);
      const result = a.multiply(b);

      expect(result).toBe(a);
      expectMatrix3Equal(a, aTimesBColumnMajor);
    });

    test('does not mutate this when out is supplied', () => {
      const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const b = new Matrix3().set(9, 8, 7, 6, 5, 4, 3, 2, 1);
      const out = new Matrix3();
      a.multiply(b, out);

      expectMatrix3Equal(a, [1, 4, 7, 2, 5, 8, 3, 6, 9]);
      expectMatrix3Equal(out, aTimesBColumnMajor);
    });
  });

  describe('premultiply', () => {
    test('this = m * this', () => {
      const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const b = new Matrix3().set(9, 8, 7, 6, 5, 4, 3, 2, 1);
      a.premultiply(b);
      const expected = new Matrix3().set(9, 8, 7, 6, 5, 4, 3, 2, 1);
      expected.multiply(new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9));

      expectMatrix3Equal(a, Array.from(expected.elements));
    });

    test('does not mutate this when out is supplied', () => {
      const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const b = new Matrix3().set(9, 8, 7, 6, 5, 4, 3, 2, 1);
      const out = new Matrix3();
      a.premultiply(b, out);

      expectMatrix3Equal(a, [1, 4, 7, 2, 5, 8, 3, 6, 9]);
    });
  });

  describe('multiplyMatrices', () => {
    test('this = a * b', () => {
      const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const b = new Matrix3().set(9, 8, 7, 6, 5, 4, 3, 2, 1);
      const out = new Matrix3();
      out.multiplyMatrices(a, b);

      expectMatrix3Equal(out, [30, 84, 138, 24, 69, 114, 18, 54, 90]);
    });
  });

  describe('multiplyScalar', () => {
    test('multiplies every element', () => {
      const m = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      m.multiplyScalar(2);

      expectMatrix3Equal(m, [2, 8, 14, 4, 10, 16, 6, 12, 18]);
    });

    test('does not mutate this when out is supplied', () => {
      const m = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const out = new Matrix3();
      m.multiplyScalar(2, out);

      expectMatrix3Equal(m, [1, 4, 7, 2, 5, 8, 3, 6, 9]);
      expectMatrix3Equal(out, [2, 8, 14, 4, 10, 16, 6, 12, 18]);
    });
  });

  describe('append (alias for multiply)', () => {
    test('produces same result as multiply', () => {
      const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const b = new Matrix3().set(9, 8, 7, 6, 5, 4, 3, 2, 1);
      const a2 = a.clone();
      a.multiply(b);
      a2.append(b);

      expect(a.equals(a2)).toBe(true);
    });
  });

  describe('prepend (alias for premultiply)', () => {
    test('produces same result as premultiply', () => {
      const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const b = new Matrix3().set(9, 8, 7, 6, 5, 4, 3, 2, 1);
      const a2 = a.clone();
      a.premultiply(b);
      a2.prepend(b);

      expect(a.equals(a2)).toBe(true);
    });
  });

  describe('appendFrom (alias for multiplyMatrices)', () => {
    test('produces same result as multiplyMatrices', () => {
      const a = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const b = new Matrix3().set(9, 8, 7, 6, 5, 4, 3, 2, 1);

      const target1 = new Matrix3();
      target1.multiplyMatrices(a, b);

      const target2 = new Matrix3();
      target2.appendFrom(a, b);

      expect(target1.equals(target2)).toBe(true);
    });
  });

  describe('determinant', () => {
    test('scale matrix determinant equals product of scales', () => {
      const m = new Matrix3().set(2, 0, 0, 0, 3, 0, 0, 0, 5);
      expect(m.determinant()).toBeCloseTo(2 * 3 * 5, 5);
    });

    test('singular matrix has determinant 0', () => {
      const twoEqualRows = new Matrix3().set(1, 2, 3, 1, 2, 3, 4, 5, 6);
      expect(twoEqualRows.determinant()).toBe(0);
    });
  });

  describe('transpose', () => {
    test('swaps rows and columns', () => {
      const m = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      m.transpose();

      expectMatrix3Equal(m, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    test('does not mutate this when out is supplied', () => {
      const m = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9);
      const out = new Matrix3();
      m.transpose(out);

      expectMatrix3Equal(m, [1, 4, 7, 2, 5, 8, 3, 6, 9]);
      expectMatrix3Equal(out, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });

  describe('getInverse', () => {
    test('A * A.inverse() = identity for non-singular matrix', () => {
      const a = new Matrix3().set(1, 2, 3, 0, 1, 4, 5, 6, 0);
      const inv = new Matrix3().getInverse(a);
      const product = new Matrix3().multiplyMatrices(a, inv);

      for (let i = 0; i < 9; i++) {
        const expected = i === 0 || i === 4 || i === 8 ? 1 : 0;
        expect(product.elements[i]).toBeCloseTo(expected, 5);
      }
    });

    test('singular matrix sets identity by default', () => {
      const singular = new Matrix3().set(1, 2, 3, 1, 2, 3, 4, 5, 6);
      const out = new Matrix3().set(9, 9, 9, 9, 9, 9, 9, 9, 9);
      out.getInverse(singular);

      expect(out.isIdentity()).toBe(true);
    });

    test('singular matrix throws when throwOnDegenerate is true', () => {
      const singular = new Matrix3().set(1, 2, 3, 1, 2, 3, 4, 5, 6);
      const out = new Matrix3();

      expect(() => out.getInverse(singular, true)).toThrow('determinant is 0');
    });

    test('does not mutate this when out is supplied', () => {
      const a = new Matrix3().set(1, 2, 3, 0, 1, 4, 5, 6, 0);
      const original = a.clone();
      const out = new Matrix3();
      a.getInverse(a, false, out);

      expect(a.equals(original)).toBe(true);
    });
  });

  describe('translate', () => {
    test('does not mutate this when out is supplied', () => {
      const m = new Matrix3();
      const out = new Matrix3();
      m.translate(10, 5, out);

      expect(m.isIdentity()).toBe(true);
      expectMatrix3Equal(out, [1, 0, 0, 0, 1, 0, 10, 5, 1]);
    });
  });

  describe('scale', () => {
    test('does not mutate this when out is supplied', () => {
      const m = new Matrix3();
      const out = new Matrix3();
      m.scale(2, 3, out);

      expect(m.isIdentity()).toBe(true);
      expectMatrix3Equal(out, [2, 0, 0, 0, 3, 0, 0, 0, 1]);
    });
  });

  describe('rotate', () => {
    test('turns +x toward +y, like pixi Matrix.rotate', () => {
      const m = new Matrix3().rotate(Math.PI / 2);
      const p = new Vector2(1, 0).applyMatrix3(m);
      const pixi = new Matrix().rotate(Math.PI / 2).apply({ x: 1, y: 0 });

      expectMatrix3Equal(m, [0, 1, 0, -1, 0, 0, 0, 0, 1]);
      expect(p.x).toBeCloseTo(0, 5);
      expect(p.y).toBeCloseTo(1, 5);
      expect(p.x).toBeCloseTo(pixi.x, 5);
      expect(p.y).toBeCloseTo(pixi.y, 5);
    });

    test('does not mutate this when out is supplied', () => {
      const m = new Matrix3();
      const out = new Matrix3();
      m.rotate(Math.PI / 2, out);

      expect(m.isIdentity()).toBe(true);
      expect(out.isIdentity()).toBe(false);
    });
  });

  describe('2D affine ops match pixi Matrix', () => {
    const fromPixi = (p: Matrix): Matrix3 => new Matrix3().set(p.a, p.c, p.tx, p.b, p.d, p.ty, 0, 0, 1);
    const start = (): Matrix => new Matrix(2, 0.5, -0.3, 1.5, 10, -4);

    test('translate', () => {
      expectMatrix3Equal(fromPixi(start()).translate(7, -3), fromPixi(start().translate(7, -3)).toArray());
    });

    test('scale', () => {
      expectMatrix3Equal(fromPixi(start()).scale(2, -0.5), fromPixi(start().scale(2, -0.5)).toArray());
    });

    test('rotate', () => {
      expectMatrix3Equal(fromPixi(start()).rotate(0.7), fromPixi(start().rotate(0.7)).toArray());
    });

    test('chained translate, rotate, scale', () => {
      const m = fromPixi(start()).translate(5, 1).rotate(-1.2).scale(3, 0.25);
      const p = start().translate(5, 1).rotate(-1.2).scale(3, 0.25);

      expectMatrix3Equal(m, fromPixi(p).toArray());
    });
  });

  describe('setUvTransform', () => {
    test('translation only', () => {
      const m = new Matrix3().setUvTransform(0.5, 0.25, 1, 1, 0, 0, 0);
      expectMatrix3Equal(m, [1, 0, 0, 0, 1, 0, 0.5, 0.25, 1]);
    });

    test('scale only', () => {
      const m = new Matrix3().setUvTransform(0, 0, 2, 3, 0, 0, 0);

      expectMatrix3Equal(m, [2, 0, 0, 0, 3, 0, 0, 0, 1]);
    });

    test('rotation only around (0,0)', () => {
      const m = new Matrix3().setUvTransform(0, 0, 1, 1, Math.PI / 2, 0, 0);
      expectMatrix3Equal(m, [0, -1, 0, 1, 0, 0, 0, 0, 1]);
    });
  });

  describe('setFromMatrix4', () => {
    test('extracts upper-left 3x3, ignoring the fourth row and column (the 99s)', () => {
      const m4 = new Matrix4().set(1, 2, 3, 99, 4, 5, 6, 99, 7, 8, 9, 99, 99, 99, 99, 99);
      const m3 = new Matrix3().setFromMatrix4(m4);

      expectMatrix3Equal(m3, [1, 4, 7, 2, 5, 8, 3, 6, 9]);
    });
  });

  describe('getNormalMatrix', () => {
    test('orthonormal rotation matrix yields the same rotation', () => {
      const m4 = new Matrix4().makeRotationY(Math.PI / 4);
      const normal = new Matrix3().getNormalMatrix(m4);

      const c = Math.cos(Math.PI / 4);
      const s = Math.sin(Math.PI / 4);
      expectMatrix3Equal(normal, [c, 0, -s, 0, 1, 0, s, 0, c]);
    });

    test('non-uniform scale yields inverse-transpose, which keeps a normal perpendicular to its surface', () => {
      const m4 = new Matrix4().makeScale(2, 3, 4);
      const normal = new Matrix3().getNormalMatrix(m4);

      expectMatrix3Equal(normal, [1 / 2, 0, 0, 0, 1 / 3, 0, 0, 0, 1 / 4]);

      const surface = new Vector3(1, 0, 0);
      const surfaceTransformed = surface.clone().applyMatrix3(new Matrix3().set(2, 0, 0, 0, 3, 0, 0, 0, 4));
      const norm = new Vector3(0, 1, 0);
      const normTransformed = norm.clone().applyMatrix3(normal);
      expect(surfaceTransformed.dot(normTransformed)).toBeCloseTo(0, 5);
    });
  });
});
