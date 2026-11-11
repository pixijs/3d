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

describe('Sphere', () => {
  describe('constructor', () => {
    test('defaults to empty (center = origin, radius = -1)', () => {
      const s = new Sphere();
      expectVec3Close(s.center, 0, 0, 0);
      expect(s.radius).toBe(-1);
    });

    test('respects supplied center and radius', () => {
      const s = new Sphere(new Vector3(1, 2, 3), 5);
      expectVec3Close(s.center, 1, 2, 3);
      expect(s.radius).toBe(5);
    });
  });

  describe('setFromBox', () => {
    test('centre at the box centre, radius half the space diagonal', () => {
      const s = new Sphere().setFromBox(new Box(new Vector3(-1, -2, -3), new Vector3(3, 2, 1)));
      expectVec3Close(s.center, 1, 0, -1);
      expect(s.radius).toBeCloseTo(0.5 * Math.hypot(4, 4, 4), 5);
    });

    test('an empty box yields an empty sphere', () => {
      const s = new Sphere(new Vector3(9, 9, 9), 5).setFromBox(new Box().makeEmpty());
      expect(s.isEmpty()).toBe(true);
      expect(s.radius).toBe(-1);
    });
  });

  describe('set', () => {
    test('overrides center and radius', () => {
      const s = new Sphere(new Vector3(1, 2, 3), 5);
      s.set({ x: -1, y: -2, z: -3 }, 10);
      expectVec3Close(s.center, -1, -2, -3);
      expect(s.radius).toBe(10);
    });
  });

  describe('copyFrom', () => {
    test('copies center and radius', () => {
      const a = new Sphere(new Vector3(1, 2, 3), 5);
      const b = new Sphere();
      b.copyFrom(a);
      expectVec3Close(b.center, 1, 2, 3);
      expect(b.radius).toBe(5);
    });
  });

  describe('copyTo', () => {
    test('copies into target', () => {
      const a = new Sphere(new Vector3(1, 2, 3), 5);
      const b = new Sphere();
      a.copyTo(b);
      expectVec3Close(b.center, 1, 2, 3);
      expect(b.radius).toBe(5);
    });
  });

  describe('clone', () => {
    test('returns a new instance with the same data', () => {
      const a = new Sphere(new Vector3(1, 2, 3), 5);
      const b = a.clone();
      expect(b).not.toBe(a);
      expect(b.equals(a)).toBe(true);
    });
  });

  describe('equals', () => {
    test('rejects different radius', () => {
      const a = new Sphere(new Vector3(1, 2, 3), 5);
      const b = new Sphere(new Vector3(1, 2, 3), 5.0001);
      expect(a.equals(b)).toBe(false);
    });

    test('rejects different center', () => {
      const a = new Sphere(new Vector3(1, 2, 3), 5);
      const b = new Sphere(new Vector3(1, 2, 4), 5);
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('makeEmpty', () => {
    test('resets to empty state', () => {
      const s = new Sphere(new Vector3(1, 2, 3), 5);
      s.makeEmpty();
      expectVec3Close(s.center, 0, 0, 0);
      expect(s.radius).toBe(-1);
      expect(s.isEmpty()).toBe(true);
    });
  });

  describe('isEmpty', () => {
    test('radius < 0 is empty', () => {
      expect(new Sphere(new Vector3(0, 0, 0), -0.1).isEmpty()).toBe(true);
    });

    test('radius == 0 is non-empty', () => {
      expect(new Sphere(new Vector3(0, 0, 0), 0).isEmpty()).toBe(false);
    });
  });

  describe('distanceToPoint', () => {
    test('point on surface returns 0', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 5);
      expect(s.distanceToPoint({ x: 5, y: 0, z: 0 })).toBeCloseTo(0, 5);
    });

    test('point inside returns negative distance, -radius at the center', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 5);
      expect(s.distanceToPoint({ x: 0, y: 0, z: 0 })).toBeCloseTo(-5, 5);
      expect(s.distanceToPoint({ x: 2, y: 0, z: 0 })).toBeCloseTo(-3, 5);
    });

    test('point outside returns positive distance', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 5);
      expect(s.distanceToPoint({ x: 10, y: 0, z: 0 })).toBeCloseTo(5, 5);
    });

    test('respects offset center', () => {
      const s = new Sphere(new Vector3(1, 2, 3), 4);
      expect(s.distanceToPoint({ x: 1, y: 2, z: 3 })).toBeCloseTo(-4, 5);
      expect(s.distanceToPoint({ x: 5, y: 2, z: 3 })).toBeCloseTo(0, 5);
    });
  });

  describe('containsPoint', () => {
    test('center is contained', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 5);
      expect(s.containsPoint({ x: 0, y: 0, z: 0 })).toBe(true);
    });

    test('boundary is inclusive', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 5);
      expect(s.containsPoint({ x: 5, y: 0, z: 0 })).toBe(true);
      expect(s.containsPoint({ x: 0, y: -5, z: 0 })).toBe(true);
    });

    test('outside returns false', () => {
      const s = new Sphere(new Vector3(0, 0, 0), 5);
      expect(s.containsPoint({ x: 6, y: 0, z: 0 })).toBe(false);
      expect(s.containsPoint({ x: 5.0001, y: 0, z: 0 })).toBe(false);
    });
  });

  describe('intersectsBox', () => {
    test('delegates to box.intersectsSphere (hit)', () => {
      const sphere = new Sphere(new Vector3(0, 0, 0), 5);
      const box = new Box(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      expect(sphere.intersectsBox(box)).toBe(true);
      expect(sphere.intersectsBox(box)).toBe(box.intersectsSphere(sphere));
    });
  });

  describe('intersectsSphere', () => {
    test('overlapping spheres intersect', () => {
      const a = new Sphere(new Vector3(0, 0, 0), 5);
      const b = new Sphere(new Vector3(3, 0, 0), 5);
      expect(a.intersectsSphere(b)).toBe(true);
    });

    test('touching spheres intersect (radius sum = distance)', () => {
      const a = new Sphere(new Vector3(0, 0, 0), 5);
      const b = new Sphere(new Vector3(10, 0, 0), 5);
      expect(a.intersectsSphere(b)).toBe(true);
    });

    test('separated spheres do not intersect', () => {
      const a = new Sphere(new Vector3(0, 0, 0), 1);
      const b = new Sphere(new Vector3(5, 0, 0), 1);
      expect(a.intersectsSphere(b)).toBe(false);
    });

    test('this empty returns false', () => {
      const a = new Sphere();
      const b = new Sphere(new Vector3(0, 0, 0), 1);
      expect(a.intersectsSphere(b)).toBe(false);
    });

    test('other empty returns false', () => {
      const a = new Sphere(new Vector3(0, 0, 0), 1);
      const b = new Sphere();
      expect(a.intersectsSphere(b)).toBe(false);
    });
  });

  describe('intersectsPlane', () => {
    test('plane through center intersects', () => {
      const sphere = new Sphere(new Vector3(0, 0, 0), 1);
      const ground = new Plane(new Vector3(0, 1, 0), 0);
      expect(sphere.intersectsPlane(ground)).toBe(true);
    });

    test('plane tangent to sphere intersects', () => {
      const sphere = new Sphere(new Vector3(0, 0, 0), 1);
      const planeAtY1 = new Plane(new Vector3(0, 1, 0), -1);
      expect(sphere.intersectsPlane(planeAtY1)).toBe(true);
    });

    test('plane outside sphere does not intersect', () => {
      const sphere = new Sphere(new Vector3(0, 0, 0), 1);
      const planeAtY5 = new Plane(new Vector3(0, 1, 0), -5);
      expect(sphere.intersectsPlane(planeAtY5)).toBe(false);
    });

    test('empty sphere returns false', () => {
      const sphere = new Sphere();
      const plane = new Plane(new Vector3(0, 1, 0), 0);
      expect(sphere.intersectsPlane(plane)).toBe(false);
    });
  });

  describe('intersectsRay', () => {
    test('delegates to ray.intersectsSphere (hit)', () => {
      const sphere = new Sphere(new Vector3(0, 0, 0), 1);
      const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
      expect(sphere.intersectsRay(ray)).toBe(true);
      expect(sphere.intersectsRay(ray)).toBe(ray.intersectsSphere(sphere));
    });
  });

  describe('applyMatrix4', () => {
    test('translation moves center', () => {
      const sphere = new Sphere(new Vector3(0, 0, 0), 5);
      const m = new Matrix4().makeTranslation(2, 3, 4);
      sphere.applyMatrix4(m);
      expectVec3Close(sphere.center, 2, 3, 4);
      expect(sphere.radius).toBeCloseTo(5, 5);
    });

    test('non-uniform scale scales the radius by the largest axis scale', () => {
      const sphere = new Sphere(new Vector3(0, 0, 0), 1);
      const m = new Matrix4().makeScale(2, 5, 3);
      sphere.applyMatrix4(m);
      expect(sphere.radius).toBeCloseTo(5, 5);
    });

    test('empty sphere stays empty', () => {
      const sphere = new Sphere();
      const m = new Matrix4().makeTranslation(2, 3, 4);
      sphere.applyMatrix4(m);
      expect(sphere.isEmpty()).toBe(true);
    });

    test('out arg variant does not mutate this', () => {
      const sphere = new Sphere(new Vector3(0, 0, 0), 1);
      const m = new Matrix4().makeTranslation(2, 3, 4);
      const out = new Sphere();
      sphere.applyMatrix4(m, out);
      expectVec3Close(sphere.center, 0, 0, 0);
      expect(sphere.radius).toBe(1);
      expectVec3Close(out.center, 2, 3, 4);
      expect(out.radius).toBeCloseTo(1, 5);
    });
  });

  describe('getBounds', () => {
    test('produces AABB enclosing sphere', () => {
      const sphere = new Sphere(new Vector3(1, 2, 3), 4);
      const bounds = sphere.getBounds();
      expectVec3Close(bounds.min, -3, -2, -1);
      expectVec3Close(bounds.max, 5, 6, 7);
    });

    test('empty sphere produces empty box', () => {
      const sphere = new Sphere();
      const bounds = sphere.getBounds();
      expect(bounds.isEmpty()).toBe(true);
    });

    test('writes into out arg when provided', () => {
      const sphere = new Sphere(new Vector3(0, 0, 0), 1);
      const out = new Box();
      const result = sphere.getBounds(out);
      expect(result).toBe(out);
      expectVec3Close(out.min, -1, -1, -1);
      expectVec3Close(out.max, 1, 1, 1);
    });
  });
});
