import { describe, expect, test } from 'vitest';

import { Matrix4 } from '~/math/matrix/Matrix4';
import { Box } from '~/math/shapes/Box';
import { Plane } from '~/math/shapes/Plane';
import { Ray } from '~/math/shapes/Ray';
import { Sphere } from '~/math/shapes/Sphere';
import { Vector3 } from '~/math/vector/Vector3';

function expectVec3Close(p: Vector3, x: number, y: number, z: number) {
  expect(p.x).toBeCloseTo(x, 5);
  expect(p.y).toBeCloseTo(y, 5);
  expect(p.z).toBeCloseTo(z, 5);
}

describe('Plane', () => {
  describe('constructor', () => {
    test('defaults to normal +X and constant 0', () => {
      const p = new Plane();
      expectVec3Close(p.normal, 1, 0, 0);
      expect(p.constant).toBe(0);
    });

    test('respects supplied normal and constant', () => {
      const p = new Plane(new Vector3(0, 1, 0), -5);
      expectVec3Close(p.normal, 0, 1, 0);
      expect(p.constant).toBe(-5);
    });
  });

  describe('set', () => {
    test('overrides normal and constant', () => {
      const p = new Plane();
      p.set({ x: 0, y: 0, z: 1 }, 7);
      expectVec3Close(p.normal, 0, 0, 1);
      expect(p.constant).toBe(7);
    });
  });

  describe('setComponents', () => {
    test('sets normal from (x, y, z) and constant from w', () => {
      const p = new Plane();
      p.setComponents(0, 1, 0, -3);
      expectVec3Close(p.normal, 0, 1, 0);
      expect(p.constant).toBe(-3);
    });
  });

  describe('setFromNormalAndCoplanarPoint', () => {
    test('sets the constant to minus normal · point, so the point satisfies the plane equation', () => {
      const p = new Plane();
      p.setFromNormalAndCoplanarPoint({ x: 0, y: 1, z: 0 }, { x: 4, y: 7, z: -2 });
      expectVec3Close(p.normal, 0, 1, 0);
      expect(p.constant).toBeCloseTo(-7, 5);
      expect(p.distanceToPoint({ x: 4, y: 7, z: -2 })).toBeCloseTo(0, 5);
    });
  });

  describe('copyFrom', () => {
    test('copies normal and constant', () => {
      const a = new Plane(new Vector3(0, 1, 0), -3);
      const b = new Plane();
      b.copyFrom(a);
      expectVec3Close(b.normal, 0, 1, 0);
      expect(b.constant).toBe(-3);
    });
  });

  describe('copyTo', () => {
    test('copies into target', () => {
      const a = new Plane(new Vector3(0, 1, 0), -3);
      const b = new Plane();
      a.copyTo(b);
      expectVec3Close(b.normal, 0, 1, 0);
      expect(b.constant).toBe(-3);
    });
  });

  describe('clone', () => {
    test('returns a new instance with the same data', () => {
      const a = new Plane(new Vector3(0, 1, 0), -3);
      const b = a.clone();
      expect(b).not.toBe(a);
      expect(b.equals(a)).toBe(true);
    });
  });

  describe('equals', () => {
    test('rejects different normal', () => {
      const a = new Plane(new Vector3(0, 1, 0), -3);
      const b = new Plane(new Vector3(0, 0, 1), -3);
      expect(a.equals(b)).toBe(false);
    });

    test('rejects different constant', () => {
      const a = new Plane(new Vector3(0, 1, 0), -3);
      const b = new Plane(new Vector3(0, 1, 0), -4);
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('normalize', () => {
    test('makes normal unit length', () => {
      const p = new Plane(new Vector3(0, 2, 0), -4);
      p.normalize();
      expect(p.normal.magnitude()).toBeCloseTo(1, 5);
    });

    test('scales constant by the same factor', () => {
      const p = new Plane(new Vector3(0, 2, 0), -4);
      p.normalize();
      expect(p.constant).toBeCloseTo(-2, 5);
    });

    test('preserves the plane equation (point on plane stays on plane)', () => {
      const planeAtY2 = new Plane(new Vector3(0, 2, 0), -4);
      const pointOnPlane = { x: 5, y: 2, z: -1 };
      expect(planeAtY2.distanceToPoint(pointOnPlane)).toBeCloseTo(0, 5);
      planeAtY2.normalize();
      expect(planeAtY2.distanceToPoint(pointOnPlane)).toBeCloseTo(0, 5);
    });

    test('out arg variant does not mutate this', () => {
      const p = new Plane(new Vector3(0, 2, 0), -4);
      const out = new Plane();
      p.normalize(out);
      expectVec3Close(p.normal, 0, 2, 0);
      expect(p.constant).toBe(-4);
      expect(out.normal.magnitude()).toBeCloseTo(1, 5);
      expect(out.constant).toBeCloseTo(-2, 5);
    });
  });

  describe('distanceToPoint', () => {
    test('point on plane returns 0', () => {
      const p = new Plane(new Vector3(0, 1, 0), 0);
      expect(p.distanceToPoint({ x: 5, y: 0, z: -2 })).toBeCloseTo(0, 5);
    });

    test('point on positive side returns positive distance', () => {
      const p = new Plane(new Vector3(0, 1, 0), 0);
      expect(p.distanceToPoint({ x: 0, y: 5, z: 0 })).toBeCloseTo(5, 5);
    });

    test('point on negative side returns negative distance', () => {
      const p = new Plane(new Vector3(0, 1, 0), 0);
      expect(p.distanceToPoint({ x: 0, y: -3, z: 0 })).toBeCloseTo(-3, 5);
    });

    test('respects non-zero constant', () => {
      const planeAtY2 = new Plane(new Vector3(0, 1, 0), -2);
      expect(planeAtY2.distanceToPoint({ x: 0, y: 2, z: 0 })).toBeCloseTo(0, 5);
      expect(planeAtY2.distanceToPoint({ x: 0, y: 5, z: 0 })).toBeCloseTo(3, 5);
    });
  });

  describe('projectPoint', () => {
    test('projection lies on the plane', () => {
      const p = new Plane(new Vector3(0, 1, 0), 0);
      const projected = p.projectPoint({ x: 4, y: 7, z: -2 });
      expectVec3Close(projected, 4, 0, -2);
      expect(p.distanceToPoint(projected)).toBeCloseTo(0, 5);
    });

    test('projection of a coplanar point returns the same point', () => {
      const p = new Plane(new Vector3(0, 1, 0), 0);
      const projected = p.projectPoint({ x: 4, y: 0, z: -2 });
      expectVec3Close(projected, 4, 0, -2);
    });

    test('writes into out arg when provided', () => {
      const p = new Plane(new Vector3(0, 1, 0), 0);
      const out = new Vector3();
      const result = p.projectPoint({ x: 4, y: 7, z: -2 }, out);
      expect(result).toBe(out);
      expectVec3Close(out, 4, 0, -2);
    });

    test('handles arbitrary normal and offset plane', () => {
      const planeAtX3 = new Plane(new Vector3(1, 0, 0), -3);
      const projected = planeAtX3.projectPoint({ x: 7, y: 1, z: 2 });
      expectVec3Close(projected, 3, 1, 2);
      expect(planeAtX3.distanceToPoint(projected)).toBeCloseTo(0, 5);
    });
  });

  describe('intersectsBox', () => {
    test('delegates to box.intersectsPlane (hit)', () => {
      const plane = new Plane(new Vector3(0, 1, 0), -0.5);
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      expect(plane.intersectsBox(box)).toBe(true);
      expect(plane.intersectsBox(box)).toBe(box.intersectsPlane(plane));
    });
  });

  describe('intersectsSphere', () => {
    test('delegates to sphere.intersectsPlane (hit)', () => {
      const plane = new Plane(new Vector3(0, 1, 0), 0);
      const sphere = new Sphere(new Vector3(0, 0, 0), 1);
      expect(plane.intersectsSphere(sphere)).toBe(true);
      expect(plane.intersectsSphere(sphere)).toBe(sphere.intersectsPlane(plane));
    });
  });

  describe('intersectsRay', () => {
    test('delegates to ray.intersectsPlane (hit)', () => {
      const plane = new Plane(new Vector3(0, 1, 0), 0);
      const ray = new Ray(new Vector3(0, 5, 0), new Vector3(0, -1, 0));
      expect(plane.intersectsRay(ray)).toBe(true);
      expect(plane.intersectsRay(ray)).toBe(ray.intersectsPlane(plane));
    });
  });

  describe('applyMatrix4', () => {
    test('translation by (0, 3, 0) moves the plane y = 0 to y = 3', () => {
      const p = new Plane(new Vector3(0, 1, 0), 0);
      const m = new Matrix4().makeTranslation(0, 3, 0);
      const coplanarOriginal = new Vector3(2, 0, -4);
      const coplanarTransformed = coplanarOriginal.clone().applyMatrix4(m);

      p.applyMatrix4(m);
      expectVec3Close(p.normal, 0, 1, 0);
      expect(p.constant).toBeCloseTo(-3, 5);
      expect(p.distanceToPoint(coplanarTransformed)).toBeCloseTo(0, 5);
    });

    test('translation parallel to plane leaves constant unchanged', () => {
      const p = new Plane(new Vector3(0, 1, 0), 0);
      const m = new Matrix4().makeTranslation(5, 0, 7);
      p.applyMatrix4(m);
      expectVec3Close(p.normal, 0, 1, 0);
      expect(p.constant).toBeCloseTo(0, 5);
    });

    test('a 90° turn about Z turns a +X normal into +Y', () => {
      const p = new Plane(new Vector3(1, 0, 0), 0);
      const m = new Matrix4().makeRotationZ(Math.PI / 2);
      p.applyMatrix4(m);
      expect(p.normal.x).toBeCloseTo(0, 5);
      expect(p.normal.y).toBeCloseTo(1, 5);
      expect(p.normal.z).toBeCloseTo(0, 5);
      expect(p.constant).toBeCloseTo(0, 5);
    });

    test('coplanar point stays coplanar after rotation about origin', () => {
      const planeAtY2 = new Plane(new Vector3(0, 1, 0), -2);
      const m = new Matrix4().makeRotationX(Math.PI / 2);
      const coplanarOriginal = new Vector3(3, 2, -1);
      const coplanarTransformed = coplanarOriginal.clone().applyMatrix4(m);

      planeAtY2.applyMatrix4(m);
      expect(planeAtY2.distanceToPoint(coplanarTransformed)).toBeCloseTo(0, 5);
    });

    test('coplanar point stays coplanar under combined translation + rotation', () => {
      const t = new Matrix4().makeTranslation(5, -2, 3);
      const r = new Matrix4().makeRotationY(Math.PI / 3);
      const m = t.clone().multiply(r);

      const planeAtY2 = new Plane(new Vector3(0, 1, 0), -2);
      const coplanarOriginal = new Vector3(7, 2, 4);
      const coplanarTransformed = coplanarOriginal.clone().applyMatrix4(m);

      planeAtY2.applyMatrix4(m);
      expect(planeAtY2.distanceToPoint(coplanarTransformed)).toBeCloseTo(0, 5);
    });

    test('non-uniform scale keeps a point of the plane x + y = 0 on the transformed plane', () => {
      const p = new Plane(new Vector3(1, 1, 0), 0).normalize();
      const m = new Matrix4().makeScale(2, 1, 1);

      const coplanarOriginal = new Vector3(1, -1, 5);
      expect(p.distanceToPoint(coplanarOriginal)).toBeCloseTo(0, 5);

      const coplanarTransformed = coplanarOriginal.clone().applyMatrix4(m);
      p.applyMatrix4(m);

      expect(p.distanceToPoint(coplanarTransformed)).toBeCloseTo(0, 5);
    });

    test('out arg variant does not mutate this', () => {
      const p = new Plane(new Vector3(0, 1, 0), 0);
      const m = new Matrix4().makeTranslation(0, 3, 0);
      const out = new Plane();
      p.applyMatrix4(m, out);
      expectVec3Close(p.normal, 0, 1, 0);
      expect(p.constant).toBe(0);
      expectVec3Close(out.normal, 0, 1, 0);
      expect(out.constant).toBeCloseTo(-3, 5);
    });
  });
});
