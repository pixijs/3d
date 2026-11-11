import { describe, expect, test } from 'vitest';

import { Matrix4 } from '~/math/matrix/Matrix4';
import { Quaternion } from '~/math/rotation/Quaternion';
import { Vector3 } from '~/math/vector/Vector3';

function expectMatrix4Equal(m: Matrix4, expectedColMajor: number[]): void {
  for (let i = 0; i < 16; i++) {
    expect(m.elements[i]).toBeCloseTo(expectedColMajor[i], 5);
  }
}

describe('Matrix4', () => {
  describe('constructor', () => {
    test('defaults to identity', () => {
      const m = new Matrix4();

      expectMatrix4Equal(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    });

    test('accepts a supplied 16-element backing array', () => {
      const elements = new Float32Array(16) as never;
      const m = new Matrix4(elements);

      expect(m.elements).toBe(elements);
    });

    test('elements64 aliases the same memory as elements', () => {
      const m = new Matrix4();
      const before = m.elements64[0];
      m.elements[0] = 0;
      m.elements[1] = 0;
      m.elements[2] = 0;
      m.elements[3] = 0;
      const after = m.elements64[0];

      expect(after).not.toBe(before);

      m.elements[0] = 1;
      m.elements[1] = 1;
      m.elements[2] = 1;
      m.elements[3] = 1;
      const afterChange = m.elements64[0];
      expect(afterChange).not.toBe(after);
    });
  });

  describe('static Matrix4.shared', () => {
    test('returns identity on every access', () => {
      const a = Matrix4.shared;
      a.set(2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17);

      const b = Matrix4.shared;
      expect(b.isIdentity()).toBe(true);
    });
  });

  describe('static Matrix4.multiplyAffine', () => {
    test('matches full multiply for two affine matrices', () => {
      const a = new Matrix4().compose(
        new Vector3(1, 2, 3),
        new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.5),
        new Vector3(2, 2, 2),
      );
      const b = new Matrix4().compose(
        new Vector3(-3, 4, 5),
        new Quaternion().setFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.7),
        new Vector3(0.5, 1, 1.5),
      );

      const expected = new Matrix4().multiplyMatrices(a, b);

      const outBuf = new Float32Array(16);
      Matrix4.multiplyAffine(outBuf, 0, a.elements as Float32Array, 0, b.elements as Float32Array, 0);

      for (let i = 0; i < 16; i++) {
        expect(outBuf[i]).toBeCloseTo(expected.elements[i], 4);
      }
    });

    test('honors offsets: identities at offset 16 multiply to an identity at offset 16', () => {
      const out = new Float32Array(32);
      const a = new Float32Array(32);
      const b = new Float32Array(32);
      a[16 + 0] = 1;
      a[16 + 5] = 1;
      a[16 + 10] = 1;
      a[16 + 15] = 1;
      b[16 + 0] = 1;
      b[16 + 5] = 1;
      b[16 + 10] = 1;
      b[16 + 15] = 1;
      Matrix4.multiplyAffine(out, 16, a, 16, b, 16);

      expect(out[16 + 0]).toBe(1);
      expect(out[16 + 5]).toBe(1);
      expect(out[16 + 10]).toBe(1);
      expect(out[16 + 15]).toBe(1);
    });
  });

  describe('set', () => {
    test('writes row-major args into column-major storage', () => {
      const m = new Matrix4();
      m.set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);

      expectMatrix4Equal(m, [1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15, 4, 8, 12, 16]);
    });
  });

  describe('identity', () => {
    test('resets to identity', () => {
      const m = new Matrix4().set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
      m.identity();

      expect(m.isIdentity()).toBe(true);
    });
  });

  describe('isIdentity', () => {
    test('false for non-identity matrix', () => {
      expect(new Matrix4().makeTranslation(1, 0, 0).isIdentity()).toBe(false);
    });
  });

  describe('copyFrom', () => {
    test('copies elements', () => {
      const a = new Matrix4().set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
      const b = new Matrix4();
      b.copyFrom(a);

      expect(b.equals(a)).toBe(true);
    });
  });

  describe('copyTo', () => {
    test('writes into target', () => {
      const a = new Matrix4().set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
      const b = new Matrix4();
      const result = a.copyTo(b);

      expect(result).toBe(b);
      expect(b.equals(a)).toBe(true);
    });
  });

  describe('equals', () => {
    test('false when any element differs', () => {
      const a = new Matrix4();
      const b = new Matrix4().makeTranslation(1, 0, 0);

      expect(a.equals(b)).toBe(false);
    });
  });

  describe('clone', () => {
    test('returns an independent copy', () => {
      const a = new Matrix4().set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
      const b = a.clone();

      expect(b).not.toBe(a);
      expect(b.equals(a)).toBe(true);
    });
  });

  describe('fromArray', () => {
    test('honors offset', () => {
      const m = new Matrix4();
      const data = [99, 99, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
      m.fromArray(data, 2);

      expectMatrix4Equal(m, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    });
  });

  describe('toArray', () => {
    test('writes column-major by default', () => {
      const m = new Matrix4().set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
      const arr = m.toArray();

      expect(Array.from(arr)).toEqual([1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15, 4, 8, 12, 16]);
    });

    test('writes row-major when transpose is true', () => {
      const m = new Matrix4().set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
      const arr = m.toArray(true);

      expect(Array.from(arr)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    });
  });

  describe('multiply', () => {
    test('translation * translation accumulates', () => {
      const a = new Matrix4().makeTranslation(1, 2, 3);
      const b = new Matrix4().makeTranslation(4, 5, 6);
      a.multiply(b);

      const p = new Vector3(0, 0, 0).applyMatrix4(a);
      expect(p.x).toBeCloseTo(5, 5);
      expect(p.y).toBeCloseTo(7, 5);
      expect(p.z).toBeCloseTo(9, 5);
    });

    test('does not mutate this when out is supplied', () => {
      const a = new Matrix4().makeTranslation(1, 2, 3);
      const original = a.clone();
      const b = new Matrix4().makeTranslation(4, 5, 6);
      const out = new Matrix4();
      a.multiply(b, out);

      expect(a.equals(original)).toBe(true);
    });
  });

  describe('premultiply', () => {
    test('this = m * this', () => {
      const a = new Matrix4().makeTranslation(1, 0, 0);
      const b = new Matrix4().makeTranslation(2, 0, 0);
      a.premultiply(b);

      const p = new Vector3(0, 0, 0).applyMatrix4(a);
      expect(p.x).toBeCloseTo(3, 5);
    });

    test('does not mutate this when out is supplied', () => {
      const a = new Matrix4().makeTranslation(1, 0, 0);
      const original = a.clone();
      const b = new Matrix4().makeTranslation(2, 0, 0);
      const out = new Matrix4();
      a.premultiply(b, out);

      expect(a.equals(original)).toBe(true);
    });
  });

  describe('multiplyScalar', () => {
    test('multiplies each element by scalar', () => {
      const m = new Matrix4().set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
      m.multiplyScalar(2);

      expectMatrix4Equal(m, [2, 10, 18, 26, 4, 12, 20, 28, 6, 14, 22, 30, 8, 16, 24, 32]);
    });

    test('does not mutate this when out is supplied', () => {
      const m = new Matrix4().set(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
      const out = new Matrix4();
      m.multiplyScalar(2, out);

      expectMatrix4Equal(m, [1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15, 4, 8, 12, 16]);
    });
  });

  describe('append, prepend, appendFrom (aliases)', () => {
    test('append matches multiply', () => {
      const a = new Matrix4().makeTranslation(1, 2, 3);
      const b = new Matrix4().makeRotationY(0.4);
      const a2 = a.clone();

      a.multiply(b);
      a2.append(b);

      expect(a.equals(a2)).toBe(true);
    });

    test('prepend matches premultiply', () => {
      const a = new Matrix4().makeTranslation(1, 2, 3);
      const b = new Matrix4().makeRotationY(0.4);
      const a2 = a.clone();

      a.premultiply(b);
      a2.prepend(b);

      expect(a.equals(a2)).toBe(true);
    });

    test('appendFrom matches multiplyMatrices', () => {
      const a = new Matrix4().makeTranslation(1, 2, 3);
      const b = new Matrix4().makeRotationY(0.4);

      const target1 = new Matrix4();
      target1.multiplyMatrices(a, b);
      const target2 = new Matrix4();
      target2.appendFrom(a, b);

      expect(target1.equals(target2)).toBe(true);
    });
  });

  describe('determinant', () => {
    test('non-singular scale has expected determinant', () => {
      const m = new Matrix4().makeScale(2, 3, 4);
      expect(m.determinant()).toBeCloseTo(2 * 3 * 4, 5);
    });
  });

  describe('transpose', () => {
    test('transpose of transpose returns original', () => {
      const original = new Matrix4().compose(
        new Vector3(1, 2, 3),
        new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.7),
        new Vector3(2, 3, 4),
      );
      const m = original.clone();
      m.transpose().transpose();

      for (let i = 0; i < 16; i++) {
        expect(m.elements[i]).toBeCloseTo(original.elements[i], 5);
      }
    });

    test('does not mutate this when out is supplied', () => {
      const m = new Matrix4().makeTranslation(1, 2, 3);
      const original = m.clone();
      const out = new Matrix4();
      m.transpose(out);

      expect(m.equals(original)).toBe(true);
      expect(out.equals(original)).toBe(false);
    });
  });

  describe('getInverse', () => {
    test('M * M⁻¹ = identity for non-singular matrix', () => {
      const m = new Matrix4().compose(
        new Vector3(1, 2, 3),
        new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.6),
        new Vector3(2, 3, 4),
      );
      const inv = new Matrix4().getInverse(m);
      const product = new Matrix4().multiplyMatrices(m, inv);

      for (let i = 0; i < 16; i++) {
        const expected = i === 0 || i === 5 || i === 10 || i === 15 ? 1 : 0;
        expect(product.elements[i]).toBeCloseTo(expected, 4);
      }
    });

    test('singular matrix sets identity by default', () => {
      const singular = new Matrix4().makeScale(0, 0, 0);
      const out = new Matrix4().set(9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9);
      out.getInverse(singular);

      expect(out.isIdentity()).toBe(true);
    });

    test('singular matrix throws when throwOnDegenerate is true', () => {
      const singular = new Matrix4().makeScale(0, 0, 0);
      const out = new Matrix4();

      expect(() => out.getInverse(singular, true)).toThrow('determinant is 0');
    });
  });

  describe('compose', () => {
    test('identity quaternion + unit scale = pure translation', () => {
      const position = new Vector3(5, 6, 7);
      const quat = new Quaternion();
      const scale = new Vector3(1, 1, 1);
      const m = new Matrix4().compose(position, quat, scale);

      expectMatrix4Equal(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]);
    });

    test('produces a TRS matrix that transforms (0,0,0) to position', () => {
      const position = new Vector3(10, 20, 30);
      const quat = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
      const scale = new Vector3(2, 3, 4);
      const m = new Matrix4().compose(position, quat, scale);

      const p = new Vector3(0, 0, 0).applyMatrix4(m);
      expect(p.x).toBeCloseTo(10, 5);
      expect(p.y).toBeCloseTo(20, 5);
      expect(p.z).toBeCloseTo(30, 5);
    });
  });

  describe('decompose', () => {
    test('round-trips position, rotation and scale, the rotation up to the sign of its quaternion', () => {
      const position = new Vector3(1, 2, 3);
      const quat = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 4);
      const scale = new Vector3(2, 3, 4);

      const m = new Matrix4().compose(position, quat, scale);

      const position2 = new Vector3();
      const quat2 = new Quaternion();
      const scale2 = new Vector3();
      m.decompose(position2, quat2, scale2);

      expect(position2.x).toBeCloseTo(position.x, 5);
      expect(position2.y).toBeCloseTo(position.y, 5);
      expect(position2.z).toBeCloseTo(position.z, 5);

      expect(scale2.x).toBeCloseTo(scale.x, 4);
      expect(scale2.y).toBeCloseTo(scale.y, 4);
      expect(scale2.z).toBeCloseTo(scale.z, 4);

      const dot = quat.x * quat2.x + quat.y * quat2.y + quat.z * quat2.z + quat.w * quat2.w;
      const signMatchingQuat = dot >= 0 ? 1 : -1;
      expect(quat2.x * signMatchingQuat).toBeCloseTo(quat.x, 4);
      expect(quat2.y * signMatchingQuat).toBeCloseTo(quat.y, 4);
      expect(quat2.z * signMatchingQuat).toBeCloseTo(quat.z, 4);
      expect(quat2.w * signMatchingQuat).toBeCloseTo(quat.w, 4);
    });

    test('flips X scale when determinant is negative to keep rotation proper', () => {
      const position = new Vector3(0, 0, 0);
      const quat = new Quaternion();
      const scale = new Vector3(-1, 1, 1);
      const m = new Matrix4().compose(position, quat, scale);

      const position2 = new Vector3();
      const quat2 = new Quaternion();
      const scale2 = new Vector3();
      m.decompose(position2, quat2, scale2);

      expect(scale2.x).toBeLessThan(0);
    });
  });

  describe('makeTranslation', () => {
    test('produces a pure translation', () => {
      const m = new Matrix4().makeTranslation(5, 6, 7);
      const p = new Vector3(1, 1, 1).applyMatrix4(m);

      expect(p.x).toBeCloseTo(6, 5);
      expect(p.y).toBeCloseTo(7, 5);
      expect(p.z).toBeCloseTo(8, 5);
    });
  });

  describe('makeScale', () => {
    test('produces a pure scale', () => {
      const m = new Matrix4().makeScale(2, 3, 4);
      const p = new Vector3(1, 1, 1).applyMatrix4(m);

      expect(p.x).toBeCloseTo(2, 5);
      expect(p.y).toBeCloseTo(3, 5);
      expect(p.z).toBeCloseTo(4, 5);
    });
  });

  describe('makeRotationX', () => {
    test('rotates (0,1,0) to (0,0,1) at theta=π/2', () => {
      const m = new Matrix4().makeRotationX(Math.PI / 2);
      const p = new Vector3(0, 1, 0).applyMatrix4(m);

      expect(p.x).toBeCloseTo(0, 5);
      expect(p.y).toBeCloseTo(0, 5);
      expect(p.z).toBeCloseTo(1, 5);
    });
  });

  describe('makeRotationY', () => {
    test('rotates (0,0,1) to (1,0,0) at theta=π/2', () => {
      const m = new Matrix4().makeRotationY(Math.PI / 2);
      const p = new Vector3(0, 0, 1).applyMatrix4(m);

      expect(p.x).toBeCloseTo(1, 5);
      expect(p.y).toBeCloseTo(0, 5);
      expect(p.z).toBeCloseTo(0, 5);
    });
  });

  describe('makeRotationZ', () => {
    test('rotates (1,0,0) to (0,1,0) at theta=π/2', () => {
      const m = new Matrix4().makeRotationZ(Math.PI / 2);
      const p = new Vector3(1, 0, 0).applyMatrix4(m);

      expect(p.x).toBeCloseTo(0, 5);
      expect(p.y).toBeCloseTo(1, 5);
      expect(p.z).toBeCloseTo(0, 5);
    });
  });

  describe('makeRotationAxis', () => {
    test('around Y axis matches makeRotationY', () => {
      const a = new Matrix4().makeRotationAxis({ x: 0, y: 1, z: 0 }, 0.3);
      const b = new Matrix4().makeRotationY(0.3);

      for (let i = 0; i < 16; i++) {
        expect(a.elements[i]).toBeCloseTo(b.elements[i], 5);
      }
    });

    test('around X axis matches makeRotationX', () => {
      const a = new Matrix4().makeRotationAxis({ x: 1, y: 0, z: 0 }, 0.4);
      const b = new Matrix4().makeRotationX(0.4);

      for (let i = 0; i < 16; i++) {
        expect(a.elements[i]).toBeCloseTo(b.elements[i], 5);
      }
    });
  });

  describe('makeRotationFromEuler', () => {
    test('matches a rotation built via Quaternion.setFromEuler', () => {
      const eulers = new Vector3(0.3, 0.4, 0.5);
      const fromEuler = new Matrix4().makeRotationFromEuler(eulers);

      const q = new Quaternion().setFromEuler(eulers);
      const fromQuat = new Matrix4().makeRotationFromQuaternion(q);

      const p = new Vector3(1, 2, 3);
      const a = p.clone().applyMatrix4(fromEuler);
      const b = p.clone().applyMatrix4(fromQuat);

      expect(a.x).toBeCloseTo(b.x, 4);
      expect(a.y).toBeCloseTo(b.y, 4);
      expect(a.z).toBeCloseTo(b.z, 4);
    });
  });

  describe('makeRotationFromQuaternion', () => {
    test('produces same rotation as the quaternion when applied to a point', () => {
      const q = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 1.1);
      const m = new Matrix4().makeRotationFromQuaternion(q);

      const p1 = new Vector3(1, 2, 3).applyMatrix4(m);
      const p2 = new Vector3(1, 2, 3).applyQuaternion(q);

      expect(p1.x).toBeCloseTo(p2.x, 4);
      expect(p1.y).toBeCloseTo(p2.y, 4);
      expect(p1.z).toBeCloseTo(p2.z, 4);
    });
  });

  describe('makePerspective', () => {
    test('shape: te[0] = f/aspect, te[5] = f, te[11] = -1', () => {
      const fovy = Math.PI / 4;
      const aspect = 16 / 9;
      const near = 0.1;
      const far = 100;
      const f = 1 / Math.tan(fovy / 2);

      const m = new Matrix4().makePerspective(fovy, aspect, near, far);
      expect(m.elements[0]).toBeCloseTo(f / aspect, 5);
      expect(m.elements[5]).toBeCloseTo(f, 5);
      expect(m.elements[11]).toBe(-1);
    });

    test('far=undefined: te[10] = -1, te[14] = -2*near', () => {
      const near = 0.5;
      const m = new Matrix4().makePerspective(Math.PI / 4, 1, near);

      expect(m.elements[10]).toBe(-1);
      expect(m.elements[14]).toBe(-2 * near);
    });

    test('far=Infinity: te[10] = -1, te[14] = -2*near', () => {
      const near = 0.5;
      const m = new Matrix4().makePerspective(Math.PI / 4, 1, near, Infinity);

      expect(m.elements[10]).toBe(-1);
      expect(m.elements[14]).toBe(-2 * near);
    });

    test('z=-near maps to NDC z=-1, z=-far maps to NDC z=+1', () => {
      const near = 0.5;
      const far = 100;
      const m = new Matrix4().makePerspective(Math.PI / 4, 1, near, far);

      const pNear = new Vector3(0, 0, -near).applyMatrix4(m);
      expect(pNear.z).toBeCloseTo(-1, 4);

      const pFar = new Vector3(0, 0, -far).applyMatrix4(m);
      expect(pFar.z).toBeCloseTo(1, 4);
    });
  });

  describe('makeOrthographic', () => {
    test('left/right/top/bottom map to ±1 at z=near', () => {
      const left = -2;
      const right = 2;
      const top = 1;
      const bottom = -1;
      const near = 0;
      const far = 10;
      const m = new Matrix4().makeOrthographic(left, right, top, bottom, near, far);

      const pLeft = new Vector3(left, 0, -near).applyMatrix4(m);
      const pRight = new Vector3(right, 0, -near).applyMatrix4(m);
      const pTop = new Vector3(0, top, -near).applyMatrix4(m);
      const pBottom = new Vector3(0, bottom, -near).applyMatrix4(m);

      expect(pLeft.x).toBeCloseTo(-1, 4);
      expect(pRight.x).toBeCloseTo(1, 4);
      expect(pTop.y).toBeCloseTo(1, 4);
      expect(pBottom.y).toBeCloseTo(-1, 4);
    });
  });

  describe('lookAt', () => {
    test('eye=(0,0,5), target=origin, up=Y produces basis x=(1,0,0), y=(0,1,0), z=(0,0,1)', () => {
      const m = new Matrix4().lookAt({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });

      expect(m.elements[0]).toBeCloseTo(1, 5);
      expect(m.elements[1]).toBeCloseTo(0, 5);
      expect(m.elements[2]).toBeCloseTo(0, 5);

      expect(m.elements[4]).toBeCloseTo(0, 5);
      expect(m.elements[5]).toBeCloseTo(1, 5);
      expect(m.elements[6]).toBeCloseTo(0, 5);

      expect(m.elements[8]).toBeCloseTo(0, 5);
      expect(m.elements[9]).toBeCloseTo(0, 5);
      expect(m.elements[10]).toBeCloseTo(1, 5);
    });

    test('only modifies upper 3x3 — translation and bottom row preserved', () => {
      const m = new Matrix4().makeTranslation(10, 20, 30);
      const before12 = m.elements[12];
      const before13 = m.elements[13];
      const before14 = m.elements[14];
      const before15 = m.elements[15];
      const before3 = m.elements[3];
      const before7 = m.elements[7];
      const before11 = m.elements[11];

      m.lookAt({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });

      expect(m.elements[12]).toBe(before12);
      expect(m.elements[13]).toBe(before13);
      expect(m.elements[14]).toBe(before14);
      expect(m.elements[15]).toBe(before15);
      expect(m.elements[3]).toBe(before3);
      expect(m.elements[7]).toBe(before7);
      expect(m.elements[11]).toBe(before11);
    });
  });

  describe('setPosition', () => {
    test('writes translation column', () => {
      const m = new Matrix4().makeRotationY(0.5);
      m.setPosition({ x: 5, y: 6, z: 7 });

      expect(m.elements[12]).toBe(5);
      expect(m.elements[13]).toBe(6);
      expect(m.elements[14]).toBe(7);
    });

    test('does not mutate this when out is supplied', () => {
      const m = new Matrix4().makeRotationY(0.5);
      const original = m.clone();
      const out = new Matrix4();
      m.setPosition({ x: 5, y: 6, z: 7 }, out);

      expect(m.equals(original)).toBe(true);
      expect(out.elements[12]).toBe(5);
    });
  });

  describe('scale (column scaling)', () => {
    test('multiplies columns 0/1/2 by v.x/v.y/v.z', () => {
      const m = new Matrix4();
      m.scale({ x: 2, y: 3, z: 4 });

      expect(m.elements[0]).toBe(2);
      expect(m.elements[5]).toBe(3);
      expect(m.elements[10]).toBe(4);
      expect(m.elements[15]).toBe(1);
    });

    test('does not mutate this when out is supplied', () => {
      const m = new Matrix4();
      const out = new Matrix4();
      m.scale({ x: 2, y: 3, z: 4 }, out);

      expect(m.isIdentity()).toBe(true);
    });
  });

  describe('extractPosition', () => {
    test('reads translation column', () => {
      const m = new Matrix4().makeTranslation(5, 6, 7);
      const out = new Vector3();
      const result = m.extractPosition(out);

      expect(result).toBe(out);
      expect(out.x).toBe(5);
      expect(out.y).toBe(6);
      expect(out.z).toBe(7);
    });
  });

  describe('extractScale', () => {
    test('reads per-axis column magnitudes', () => {
      const m = new Matrix4().makeScale(2, 3, 4);
      const out = new Vector3();
      m.extractScale(out);

      expect(out.x).toBeCloseTo(2, 5);
      expect(out.y).toBeCloseTo(3, 5);
      expect(out.z).toBeCloseTo(4, 5);
    });
  });

  describe('extractBasis', () => {
    test('writes the three column basis vectors', () => {
      const m = new Matrix4().makeScale(2, 3, 4);
      const x = new Vector3();
      const y = new Vector3();
      const z = new Vector3();
      m.extractBasis(x, y, z);

      expect(x.x).toBe(2);
      expect(x.y).toBe(0);
      expect(x.z).toBe(0);

      expect(y.x).toBe(0);
      expect(y.y).toBe(3);
      expect(y.z).toBe(0);

      expect(z.x).toBe(0);
      expect(z.y).toBe(0);
      expect(z.z).toBe(4);
    });
  });

  describe('makeBasis', () => {
    test('writes the x, y and z axes as columns 0, 1 and 2', () => {
      const xAxis = { x: 0, y: 1, z: 0 };
      const yAxis = { x: -1, y: 0, z: 0 };
      const zAxis = { x: 0, y: 0, z: 1 };
      const m = new Matrix4().makeBasis(xAxis, yAxis, zAxis);

      expect(m.elements[0]).toBe(0);
      expect(m.elements[1]).toBe(1);
      expect(m.elements[2]).toBe(0);

      expect(m.elements[4]).toBe(-1);
      expect(m.elements[5]).toBe(0);
      expect(m.elements[6]).toBe(0);

      expect(m.elements[8]).toBe(0);
      expect(m.elements[9]).toBe(0);
      expect(m.elements[10]).toBe(1);
    });
  });

  describe('extractRotation', () => {
    test('removes scale from a TRS matrix, leaving unit-length columns and no translation', () => {
      const m = new Matrix4().compose(
        new Vector3(0, 0, 0),
        new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.6),
        new Vector3(2, 3, 4),
      );
      const r = new Matrix4().extractRotation(m);

      const c0Len = Math.sqrt(r.elements[0] ** 2 + r.elements[1] ** 2 + r.elements[2] ** 2);
      const c1Len = Math.sqrt(r.elements[4] ** 2 + r.elements[5] ** 2 + r.elements[6] ** 2);
      const c2Len = Math.sqrt(r.elements[8] ** 2 + r.elements[9] ** 2 + r.elements[10] ** 2);

      expect(c0Len).toBeCloseTo(1, 4);
      expect(c1Len).toBeCloseTo(1, 4);
      expect(c2Len).toBeCloseTo(1, 4);

      expect(r.elements[12]).toBe(0);
      expect(r.elements[13]).toBe(0);
      expect(r.elements[14]).toBe(0);
      expect(r.elements[15]).toBe(1);
    });
  });

  describe('extractForward', () => {
    test('returns negated normalized Z column, (0, 0, -1) for identity', () => {
      const identity = new Matrix4();
      const out = new Vector3();
      identity.extractForward(out);

      expect(out.x).toBeCloseTo(0, 5);
      expect(out.y).toBeCloseTo(0, 5);
      expect(out.z).toBeCloseTo(-1, 5);
    });

    test('returns unit length even when Z column is scaled', () => {
      const m = new Matrix4().makeScale(1, 1, 5);
      const out = new Vector3();
      m.extractForward(out);

      const len = Math.sqrt(out.x ** 2 + out.y ** 2 + out.z ** 2);
      expect(len).toBeCloseTo(1, 5);
    });
  });

  describe('extractRight', () => {
    test('returns normalized X column', () => {
      const m = new Matrix4();
      const out = new Vector3();
      m.extractRight(out);

      expect(out.x).toBeCloseTo(1, 5);
      expect(out.y).toBeCloseTo(0, 5);
      expect(out.z).toBeCloseTo(0, 5);
    });

    test('returns unit length even when X column is scaled', () => {
      const m = new Matrix4().makeScale(5, 1, 1);
      const out = new Vector3();
      m.extractRight(out);

      const len = Math.sqrt(out.x ** 2 + out.y ** 2 + out.z ** 2);
      expect(len).toBeCloseTo(1, 5);
    });
  });

  describe('extractUp', () => {
    test('returns normalized Y column', () => {
      const m = new Matrix4();
      const out = new Vector3();
      m.extractUp(out);

      expect(out.x).toBeCloseTo(0, 5);
      expect(out.y).toBeCloseTo(1, 5);
      expect(out.z).toBeCloseTo(0, 5);
    });

    test('returns unit length even when Y column is scaled', () => {
      const m = new Matrix4().makeScale(1, 5, 1);
      const out = new Vector3();
      m.extractUp(out);

      const len = Math.sqrt(out.x ** 2 + out.y ** 2 + out.z ** 2);
      expect(len).toBeCloseTo(1, 5);
    });
  });

  describe('getMaxScaleOnAxis', () => {
    test('returns largest of three axis scales', () => {
      const m = new Matrix4().makeScale(2, 5, 3);

      expect(m.getMaxScaleOnAxis()).toBeCloseTo(5, 5);
    });
  });
});
