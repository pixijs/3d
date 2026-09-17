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

  describe('type', () => {
    test('is "plane"', () => {
      expect(new Plane().type).toBe('plane');
    });
  });

  describe('set', () => {
    test('overrides normal and constant', () => {
      const p = new Plane();
      p.set({ x: 0, y: 0, z: 1 }, 7);
      expectVec3Close(p.normal, 0, 0, 1);
      expect(p.constant).toBe(7);
    });

    test('returns this', () => {
      const p = new Plane();
      expect(p.set({ x: 1, y: 0, z: 0 }, 0)).toBe(p);
    });
  });

  describe('setComponents', () => {
    test('sets normal from (x, y, z) and constant from w', () => {
      const p = new Plane();
      p.setComponents(0, 1, 0, -3);
      expectVec3Close(p.normal, 0, 1, 0);
      expect(p.constant).toBe(-3);
    });

    test('returns this', () => {
      const p = new Plane();
      expect(p.setComponents(1, 0, 0, 0)).toBe(p);
    });
  });

  describe('setFromNormalAndCoplanarPoint', () => {
    test('makes the coplanar point satisfy the plane equation', () => {
      const p = new Plane();
      p.setFromNormalAndCoplanarPoint({ x: 0, y: 1, z: 0 }, { x: 4, y: 7, z: -2 });
      expectVec3Close(p.normal, 0, 1, 0);
      // Plane equation: 0*x + 1*y + 0*z + constant = 0 → constant = -y = -7.
      expect(p.constant).toBeCloseTo(-7, 5);
      // Verify: distanceToPoint of the coplanar point is 0.
      expect(p.distanceToPoint({ x: 4, y: 7, z: -2 })).toBeCloseTo(0, 5);
    });

    test('returns this', () => {
      const p = new Plane();
      expect(p.setFromNormalAndCoplanarPoint({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 })).toBe(p);
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

    test('returns target', () => {
      const a = new Plane(new Vector3(0, 1, 0), -3);
      const b = new Plane();
      expect(a.copyTo(b)).toBe(b);
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
    test('matches exactly', () => {
      const a = new Plane(new Vector3(0, 1, 0), -3);
      const b = new Plane(new Vector3(0, 1, 0), -3);
      expect(a.equals(b)).toBe(true);
    });

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
      // |normal| = 2, so factor = 1/2; constant scales from -4 to -2. New plane y - 2 = 0, i.e. y = 2.
      const p = new Plane(new Vector3(0, 2, 0), -4);
      p.normalize();
      expect(p.constant).toBeCloseTo(-2, 5);
    });

    test('preserves the plane equation (point on plane stays on plane)', () => {
      // Original plane: 0*x + 2*y + 0*z - 4 = 0, i.e. y = 2. Point (5, 2, -1) lies on plane.
      const p = new Plane(new Vector3(0, 2, 0), -4);
      const point = { x: 5, y: 2, z: -1 };
      // The un-normalized signed value (which equals 0 for points on the plane) is 0.
      expect(p.distanceToPoint(point)).toBeCloseTo(0, 5);
      p.normalize();
      // After normalization, distanceToPoint gives the true Euclidean signed distance — also 0.
      expect(p.distanceToPoint(point)).toBeCloseTo(0, 5);
    });

    test('out arg variant does not mutate this', () => {
      const p = new Plane(new Vector3(0, 2, 0), -4);
      const out = new Plane();
      p.normalize(out);
      // Original is unchanged.
      expectVec3Close(p.normal, 0, 2, 0);
      expect(p.constant).toBe(-4);
      // Out is normalized.
      expect(out.normal.magnitude()).toBeCloseTo(1, 5);
      expect(out.constant).toBeCloseTo(-2, 5);
    });
  });

  describe('distanceToPoint', () => {
    test('point on plane returns 0', () => {
      // Plane y = 0 (normal +Y, constant 0).
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
      // Plane y = 2 (normal +Y, constant -2).
      const p = new Plane(new Vector3(0, 1, 0), -2);
      expect(p.distanceToPoint({ x: 0, y: 2, z: 0 })).toBeCloseTo(0, 5);
      expect(p.distanceToPoint({ x: 0, y: 5, z: 0 })).toBeCloseTo(3, 5);
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
      // Plane normal (1, 0, 0), constant -3 → x = 3.
      const p = new Plane(new Vector3(1, 0, 0), -3);
      const projected = p.projectPoint({ x: 7, y: 1, z: 2 });
      expectVec3Close(projected, 3, 1, 2);
      expect(p.distanceToPoint(projected)).toBeCloseTo(0, 5);
    });
  });

  describe('intersectsBox', () => {
    test('delegates to box.intersectsPlane (hit)', () => {
      const plane = new Plane(new Vector3(0, 1, 0), -0.5);
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      expect(plane.intersectsBox(box)).toBe(true);
      expect(plane.intersectsBox(box)).toBe(box.intersectsPlane(plane));
    });

    test('delegates to box.intersectsPlane (miss)', () => {
      const plane = new Plane(new Vector3(0, 1, 0), -5);
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      expect(plane.intersectsBox(box)).toBe(false);
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

    test('delegates to sphere.intersectsPlane (miss)', () => {
      const plane = new Plane(new Vector3(0, 1, 0), -5);
      const sphere = new Sphere(new Vector3(0, 0, 0), 1);
      expect(plane.intersectsSphere(sphere)).toBe(false);
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

    test('delegates to ray.intersectsPlane (miss)', () => {
      // Ray pointing away from the plane (origin above, direction up).
      const plane = new Plane(new Vector3(0, 1, 0), 0);
      const ray = new Ray(new Vector3(0, 5, 0), new Vector3(0, 1, 0));
      expect(plane.intersectsRay(ray)).toBe(false);
      expect(plane.intersectsRay(ray)).toBe(ray.intersectsPlane(plane));
    });
  });

  describe('applyMatrix4', () => {
    test('translation shifts plane along its normal direction', () => {
      // Plane y = 0 (normal +Y, constant 0). Translate by (0, 3, 0). New plane: y = 3 → constant = -3.
      const p = new Plane(new Vector3(0, 1, 0), 0);
      const m = new Matrix4().makeTranslation(0, 3, 0);
      const coplanarOriginal = new Vector3(2, 0, -4);
      const coplanarTransformed = coplanarOriginal.clone().applyMatrix4(m);

      p.applyMatrix4(m);
      expectVec3Close(p.normal, 0, 1, 0);
      expect(p.constant).toBeCloseTo(-3, 5);
      // The transformed coplanar point still satisfies the equation.
      expect(p.distanceToPoint(coplanarTransformed)).toBeCloseTo(0, 5);
    });

    test('translation parallel to plane leaves constant unchanged', () => {
      // Plane y = 0; translate along X — plane equation does not change.
      const p = new Plane(new Vector3(0, 1, 0), 0);
      const m = new Matrix4().makeTranslation(5, 0, 7);
      p.applyMatrix4(m);
      expectVec3Close(p.normal, 0, 1, 0);
      expect(p.constant).toBeCloseTo(0, 5);
    });

    test('rotation rotates the normal correctly', () => {
      // Plane normal +X, constant 0 (the YZ plane: x = 0). Rotate 90° about Z → normal becomes +Y.
      const p = new Plane(new Vector3(1, 0, 0), 0);
      const m = new Matrix4().makeRotationZ(Math.PI / 2);
      p.applyMatrix4(m);
      expect(p.normal.x).toBeCloseTo(0, 5);
      expect(p.normal.y).toBeCloseTo(1, 5);
      expect(p.normal.z).toBeCloseTo(0, 5);
      expect(p.constant).toBeCloseTo(0, 5);
    });

    test('coplanar point stays coplanar after rotation about origin', () => {
      // Plane y = 2 (normal +Y, constant -2). Rotate 90° about X → plane becomes z = 2.
      const p = new Plane(new Vector3(0, 1, 0), -2);
      const m = new Matrix4().makeRotationX(Math.PI / 2);
      const coplanarOriginal = new Vector3(3, 2, -1);
      const coplanarTransformed = coplanarOriginal.clone().applyMatrix4(m);

      p.applyMatrix4(m);
      expect(p.distanceToPoint(coplanarTransformed)).toBeCloseTo(0, 5);
    });

    test('coplanar point stays coplanar under combined translation + rotation', () => {
      const t = new Matrix4().makeTranslation(5, -2, 3);
      const r = new Matrix4().makeRotationY(Math.PI / 3);
      const m = t.clone().multiply(r);

      // Plane normal (0, 1, 0), constant -2 (the plane y = 2).
      const p = new Plane(new Vector3(0, 1, 0), -2);
      const coplanarOriginal = new Vector3(7, 2, 4);
      const coplanarTransformed = coplanarOriginal.clone().applyMatrix4(m);

      p.applyMatrix4(m);
      expect(p.distanceToPoint(coplanarTransformed)).toBeCloseTo(0, 5);
    });

    test('non-uniform scale preserves the plane via inverse-transpose normal handling', () => {
      // A plane normal (1, 1, 0)/sqrt(2) at constant 0. Coplanar points satisfy x + y = 0.
      const p = new Plane(new Vector3(1, 1, 0), 0).normalize();
      const m = new Matrix4().makeScale(2, 1, 1);

      // Pick a coplanar point: (1, -1, 5). Confirm it's on the original plane.
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
      // Original is unchanged.
      expectVec3Close(p.normal, 0, 1, 0);
      expect(p.constant).toBe(0);
      // Out reflects the transform.
      expectVec3Close(out.normal, 0, 1, 0);
      expect(out.constant).toBeCloseTo(-3, 5);
    });
  });

  describe('toString', () => {
    test('formats normal and constant', () => {
      const p = new Plane(new Vector3(0, 1, 0), -3);
      expect(p.toString()).toBe('[pixi-3d/math:Plane normal=(0, 1, 0) constant=-3]');
    });
  });
});
