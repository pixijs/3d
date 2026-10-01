import { describe, expect, test } from 'vitest';

import { Matrix4 } from '~/math/matrix/Matrix4';
import { Box } from '~/math/shapes/Box';
import { Plane } from '~/math/shapes/Plane';
import { Ray } from '~/math/shapes/Ray';
import { Sphere } from '~/math/shapes/Sphere';
import { Vector3 } from '~/math/vector/Vector3';

function expectVec3Close(actual: Vector3, x: number, y: number, z: number) {
  expect(actual.x).toBeCloseTo(x, 5);
  expect(actual.y).toBeCloseTo(y, 5);
  expect(actual.z).toBeCloseTo(z, 5);
}

describe('Ray', () => {
  describe('constructor', () => {
    test('defaults to origin (0, 0, 0) and direction (0, 0, -1)', () => {
      const ray = new Ray();
      expectVec3Close(ray.origin, 0, 0, 0);
      expectVec3Close(ray.direction, 0, 0, -1);
    });

    test('respects supplied origin and direction', () => {
      const origin = new Vector3(1, 2, 3);
      const direction = new Vector3(0, 1, 0);
      const ray = new Ray(origin, direction);
      expect(ray.origin).toBe(origin);
      expect(ray.direction).toBe(direction);
    });
  });

  describe('set', () => {
    test('sets origin and direction', () => {
      const ray = new Ray();
      ray.set({ x: 1, y: 2, z: 3 }, { x: 0, y: 1, z: 0 });
      expectVec3Close(ray.origin, 1, 2, 3);
      expectVec3Close(ray.direction, 0, 1, 0);
    });
  });

  describe('copyFrom', () => {
    test('copies origin and direction', () => {
      const a = new Ray(new Vector3(1, 2, 3), new Vector3(0, 1, 0));
      const b = new Ray();
      b.copyFrom(a);
      expectVec3Close(b.origin, 1, 2, 3);
      expectVec3Close(b.direction, 0, 1, 0);
    });
  });

  describe('copyTo', () => {
    test('copies into target and returns target', () => {
      const a = new Ray(new Vector3(4, 5, 6), new Vector3(1, 0, 0));
      const b = new Ray();
      const result = a.copyTo(b);
      expect(result).toBe(b);
      expectVec3Close(b.origin, 4, 5, 6);
      expectVec3Close(b.direction, 1, 0, 0);
    });
  });

  describe('clone', () => {
    test('returns a new Ray with the same origin and direction', () => {
      const a = new Ray(new Vector3(1, 2, 3), new Vector3(0, 1, 0));
      const b = a.clone();
      expect(b).not.toBe(a);
      expectVec3Close(b.origin, 1, 2, 3);
      expectVec3Close(b.direction, 0, 1, 0);
    });
  });

  describe('equals', () => {
    test('returns true for matching origin and direction', () => {
      const a = new Ray(new Vector3(1, 2, 3), new Vector3(0, 0, -1));
      const b = new Ray(new Vector3(1, 2, 3), new Vector3(0, 0, -1));
      expect(a.equals(b)).toBe(true);
    });

    test('returns false for different origin', () => {
      const a = new Ray(new Vector3(1, 2, 3), new Vector3(0, 0, -1));
      const b = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      expect(a.equals(b)).toBe(false);
    });

    test('returns false for different direction', () => {
      const a = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const b = new Ray(new Vector3(0, 0, 0), new Vector3(0, 1, 0));
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('at', () => {
    test('default ray at(5) = (0, 0, -5)', () => {
      const ray = new Ray();
      const result = ray.at(5);
      expectVec3Close(result, 0, 0, -5);
    });

    test('origin (1, 2, 3) direction (0, 0, 1) at(2) = (1, 2, 5)', () => {
      const ray = new Ray(new Vector3(1, 2, 3), new Vector3(0, 0, 1));
      const result = ray.at(2);
      expectVec3Close(result, 1, 2, 5);
    });

    test('at(0) returns origin', () => {
      const ray = new Ray(new Vector3(1, 2, 3), new Vector3(0, 0, 1));
      const result = ray.at(0);
      expectVec3Close(result, 1, 2, 3);
    });

    test('writes into supplied out and returns it', () => {
      const ray = new Ray();
      const out = new Vector3();
      const result = ray.at(5, out);
      expect(result).toBe(out);
      expectVec3Close(out, 0, 0, -5);
    });
  });

  describe('closestPointToPoint', () => {
    test('point in front of origin projects onto ray', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const out = new Vector3();
      ray.closestPointToPoint({ x: 1, y: 0, z: -5 }, out);
      expectVec3Close(out, 0, 0, -5);
    });

    test('point behind origin returns origin (clamped to forward half-line)', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const out = new Vector3();
      ray.closestPointToPoint({ x: 0, y: 0, z: 5 }, out);
      expectVec3Close(out, 0, 0, 0);
    });

    test('point at origin returns origin', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const out = new Vector3();
      ray.closestPointToPoint({ x: 0, y: 0, z: 0 }, out);
      expectVec3Close(out, 0, 0, 0);
    });
  });

  describe('distanceToPoint', () => {
    test('point off ray returns perpendicular distance', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      expect(ray.distanceToPoint({ x: 3, y: 4, z: -5 })).toBeCloseTo(5, 5);
    });
  });

  describe('distanceSqToPoint', () => {
    test('point on ray returns 0', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      expect(ray.distanceSqToPoint({ x: 0, y: 0, z: -5 })).toBeCloseTo(0, 5);
    });

    test('point off ray returns squared perpendicular distance', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      expect(ray.distanceSqToPoint({ x: 3, y: 4, z: -5 })).toBeCloseTo(25, 5);
    });

    test('point behind origin returns squared distance to origin', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      expect(ray.distanceSqToPoint({ x: 0, y: 0, z: 5 })).toBeCloseTo(25, 5);
    });
  });

  describe('intersectSphere', () => {
    test('sphere in front of ray returns entry point', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const sphere = new Sphere(new Vector3(0, 0, -10), 2);
      const out = new Vector3();
      const result = ray.intersectSphere(sphere, out);
      expect(result).toBe(out);
      expectVec3Close(out, 0, 0, -8);
    });

    test('ray missing sphere returns null', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const sphere = new Sphere(new Vector3(10, 0, -10), 2);
      const result = ray.intersectSphere(sphere);
      expect(result).toBeNull();
    });
  });

  describe('intersectSphereT', () => {
    test('returns the distance to the entry point', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const sphere = new Sphere(new Vector3(0, 0, -10), 2);
      expect(ray.intersectSphereT(sphere)).toBeCloseTo(8, 5);
    });

    test('returns the distance to the exit point when the origin is inside', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const sphere = new Sphere(new Vector3(0, 0, 0), 2);
      expect(ray.intersectSphereT(sphere)).toBeCloseTo(2, 5);
    });

    test('returns -1 when the ray misses', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      expect(ray.intersectSphereT(new Sphere(new Vector3(10, 0, -10), 2))).toBe(-1);
    });

    test('returns -1 when the sphere is behind the ray', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      expect(ray.intersectSphereT(new Sphere(new Vector3(0, 0, 10), 2))).toBe(-1);
    });

    test('returns -1 for a negative-radius (empty) sphere', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      expect(ray.intersectSphereT(new Sphere(new Vector3(0, 0, -10), -1))).toBe(-1);
    });

    test('agrees with intersectSphere: at(t) is the hit point', () => {
      const d = new Vector3(1, 2, -3).normalize();
      const ray = new Ray(new Vector3(-2, 1, 4), d);
      const sphere = new Sphere(new Vector3(1, 4, -2), 1.5);
      const point = ray.intersectSphere(sphere) as Vector3;
      const t = ray.intersectSphereT(sphere);
      expect(t).toBeGreaterThan(0);
      expectVec3Close(ray.at(t), point.x, point.y, point.z);
    });
  });

  describe('intersectsSphere', () => {
    test('returns true when ray hits sphere', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const sphere = new Sphere(new Vector3(0, 0, -10), 2);
      expect(ray.intersectsSphere(sphere)).toBe(true);
    });

    test('returns false when ray misses sphere', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const sphere = new Sphere(new Vector3(10, 0, -10), 2);
      expect(ray.intersectsSphere(sphere)).toBe(false);
    });

    test('returns false for negative-radius (empty) sphere', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const sphere = new Sphere(new Vector3(0, 0, -10), -1);
      expect(ray.intersectsSphere(sphere)).toBe(false);
    });

    test('returns true when ray origin is inside sphere', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const sphere = new Sphere(new Vector3(0, 0, 0), 2);
      expect(ray.intersectsSphere(sphere)).toBe(true);
    });
  });

  describe('intersectPlane', () => {
    test('plane perpendicular to ray returns hit point', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const planeAtZMinus5 = new Plane(new Vector3(0, 0, 1), 5);
      const out = new Vector3();
      const result = ray.intersectPlane(planeAtZMinus5, out);
      expect(result).toBe(out);
      expectVec3Close(out, 0, 0, -5);
    });

    test('plane parallel to ray returns null', () => {
      const rayAboveGround = new Ray(new Vector3(0, 1, 0), new Vector3(0, 0, -1));
      const ground = new Plane(new Vector3(0, 1, 0), 0);
      const result = rayAboveGround.intersectPlane(ground);
      expect(result).toBeNull();
    });

    test('plane containing ray (denominator=0 AND distanceToOrigin=0) returns origin', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const ground = new Plane(new Vector3(0, 1, 0), 0);
      const out = new Vector3();
      const result = ray.intersectPlane(ground, out);
      expect(result).toBe(out);
      expectVec3Close(out, 0, 0, 0);
    });

    test('plane behind ray returns null', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const planeAtZ5 = new Plane(new Vector3(0, 0, 1), -5);
      const result = ray.intersectPlane(planeAtZ5);
      expect(result).toBeNull();
    });
  });

  describe('intersectsPlane', () => {
    test('returns true when ray origin is on plane', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const plane = new Plane(new Vector3(0, 1, 0), 0);
      expect(ray.intersectsPlane(plane)).toBe(true);
    });

    test('returns false when the ray starts on the positive side and points away from the plane', () => {
      const ray = new Ray(new Vector3(0, 5, 0), new Vector3(0, 1, 0));
      const plane = new Plane(new Vector3(0, 1, 0), 0);
      expect(ray.intersectsPlane(plane)).toBe(false);
    });

    test('returns true when ray points toward plane from one side', () => {
      const ray = new Ray(new Vector3(0, 5, 0), new Vector3(0, -1, 0));
      const plane = new Plane(new Vector3(0, 1, 0), 0);
      expect(ray.intersectsPlane(plane)).toBe(true);
    });
  });

  describe('intersectBox', () => {
    test('ray hits box from outside returns entry point', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const box = new Box(new Vector3(-1, -1, -10), new Vector3(1, 1, -5));
      const out = new Vector3();
      const result = ray.intersectBox(box, out);
      expect(result).toBe(out);
      expectVec3Close(out, 0, 0, -5);
    });

    test('ray pointing away from box returns null', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, 1));
      const box = new Box(new Vector3(-1, -1, -10), new Vector3(1, 1, -5));
      const result = ray.intersectBox(box);
      expect(result).toBeNull();
    });

    test('axis-aligned ray (1, 0, 0) hits box (NaN-propagation guard)', () => {
      const ray = new Ray(new Vector3(-10, 0, 0), new Vector3(1, 0, 0));
      const box = new Box(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      const out = new Vector3();
      const result = ray.intersectBox(box, out);
      expect(result).toBe(out);
      expectVec3Close(out, -1, 0, 0);
    });
  });

  describe('intersectBoxT', () => {
    test('returns the distance to the entry face', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const box = new Box(new Vector3(-1, -1, -10), new Vector3(1, 1, -5));
      expect(ray.intersectBoxT(box)).toBeCloseTo(5, 5);
    });

    test('returns the distance to the exit face when the origin is inside', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const box = new Box(new Vector3(-5, -5, -5), new Vector3(5, 5, 5));
      expect(ray.intersectBoxT(box)).toBeCloseTo(5, 5);
    });

    test('returns -1 when the ray points away from the box', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, 1));
      const box = new Box(new Vector3(-1, -1, -10), new Vector3(1, 1, -5));
      expect(ray.intersectBoxT(box)).toBe(-1);
    });

    test('returns -1 for an axis-aligned ray missing the box (NaN-propagation guard)', () => {
      const ray = new Ray(new Vector3(10, 0, 0), new Vector3(0, 0, -1));
      const box = new Box(new Vector3(-1, -1, -10), new Vector3(1, 1, -5));
      expect(ray.intersectBoxT(box)).toBe(-1);
    });

    test('is parametric: a direction of length 2 reaches the face 5 units away at t = 2.5', () => {
      const box = new Box(new Vector3(-1, -1, -10), new Vector3(1, 1, -5));
      expect(new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -2)).intersectBoxT(box)).toBeCloseTo(2.5, 5);
    });

    test('agrees with intersectBox: at(t) is the hit point', () => {
      const d = new Vector3(1, 2, -3).normalize();
      const ray = new Ray(new Vector3(-2, 1, 4), d);
      const box = new Box(new Vector3(-1, 2, -3), new Vector3(3, 6, 1));
      const point = ray.intersectBox(box) as Vector3;
      const t = ray.intersectBoxT(box);
      expect(t).toBeGreaterThan(0);
      expectVec3Close(ray.at(t), point.x, point.y, point.z);
    });
  });

  describe('intersectsBox', () => {
    test('returns true when ray enters box', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const box = new Box(new Vector3(-1, -1, -10), new Vector3(1, 1, -5));
      expect(ray.intersectsBox(box)).toBe(true);
    });

    test('returns false when ray points away from box', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, 1));
      const box = new Box(new Vector3(-1, -1, -10), new Vector3(1, 1, -5));
      expect(ray.intersectsBox(box)).toBe(false);
    });
  });

  describe('applyMatrix4', () => {
    test('translates the origin and leaves direction invariant', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const m = new Matrix4().makeTranslation(1, 2, 3);
      ray.applyMatrix4(m);
      expectVec3Close(ray.origin, 1, 2, 3);
      expectVec3Close(ray.direction, 0, 0, -1);
    });

    test('a 90° turn about Y turns a -Z direction into -X', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const m = new Matrix4().makeRotationY(Math.PI / 2);
      ray.applyMatrix4(m);
      expectVec3Close(ray.direction, -1, 0, 0);
    });

    test('renormalizes the direction under non-uniform scale', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const m = new Matrix4().makeScale(2, 3, 4);
      ray.applyMatrix4(m);
      expect(ray.direction.magnitude()).toBeCloseTo(1, 5);
    });

    test('writes into out when supplied without mutating this', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const out = new Ray();
      const m = new Matrix4().makeTranslation(1, 2, 3);
      ray.applyMatrix4(m, out);
      expectVec3Close(ray.origin, 0, 0, 0);
      expectVec3Close(out.origin, 1, 2, 3);
    });
  });
});
