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

describe('Box', () => {
  describe('constructor', () => {
    test('defaults to empty box (min = +Inf, max = -Inf)', () => {
      const box = new Box();
      expect(box.min.x).toBe(Infinity);
      expect(box.min.y).toBe(Infinity);
      expect(box.min.z).toBe(Infinity);
      expect(box.max.x).toBe(-Infinity);
      expect(box.max.y).toBe(-Infinity);
      expect(box.max.z).toBe(-Infinity);
    });

    test('respects supplied corners', () => {
      const min = new Vector3(-1, -2, -3);
      const max = new Vector3(4, 5, 6);
      const box = new Box(min, max);
      expectVec3Close(box.min, -1, -2, -3);
      expectVec3Close(box.max, 4, 5, 6);
    });
  });

  describe('set', () => {
    test('overrides corners', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      box.set({ x: -2, y: -3, z: -4 }, { x: 5, y: 6, z: 7 });
      expectVec3Close(box.min, -2, -3, -4);
      expectVec3Close(box.max, 5, 6, 7);
    });
  });

  describe('copyFrom', () => {
    test('copies both corners', () => {
      const a = new Box(new Vector3(1, 2, 3), new Vector3(4, 5, 6));
      const b = new Box();
      b.copyFrom(a);
      expectVec3Close(b.min, 1, 2, 3);
      expectVec3Close(b.max, 4, 5, 6);
    });
  });

  describe('copyTo', () => {
    test('copies into target', () => {
      const a = new Box(new Vector3(1, 2, 3), new Vector3(4, 5, 6));
      const b = new Box();
      a.copyTo(b);
      expectVec3Close(b.min, 1, 2, 3);
      expectVec3Close(b.max, 4, 5, 6);
    });
  });

  describe('clone', () => {
    test('returns a new instance with the same corners', () => {
      const a = new Box(new Vector3(1, 2, 3), new Vector3(4, 5, 6));
      const b = a.clone();
      expect(b).not.toBe(a);
      expect(b.equals(a)).toBe(true);
    });
  });

  describe('equals', () => {
    test('rejects mismatch', () => {
      const a = new Box(new Vector3(1, 2, 3), new Vector3(4, 5, 6));
      const b = new Box(new Vector3(1, 2, 3), new Vector3(4, 5, 7));
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('makeEmpty', () => {
    test('resets to empty state', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      box.makeEmpty();
      expect(box.min.x).toBe(Infinity);
      expect(box.max.x).toBe(-Infinity);
      expect(box.isEmpty()).toBe(true);
    });
  });

  describe('isEmpty', () => {
    test('valid box is non-empty', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      expect(box.isEmpty()).toBe(false);
    });

    test('a single axis with max < min makes the box empty, whichever axis it is', () => {
      const xFlipped = new Box(new Vector3(2, 0, 0), new Vector3(1, 5, 5));
      expect(xFlipped.isEmpty()).toBe(true);

      const yFlipped = new Box(new Vector3(0, 2, 0), new Vector3(5, 1, 5));
      expect(yFlipped.isEmpty()).toBe(true);

      const zFlipped = new Box(new Vector3(0, 0, 2), new Vector3(5, 5, 1));
      expect(zFlipped.isEmpty()).toBe(true);
    });

    test('singular box (min == max) is non-empty', () => {
      const box = new Box(new Vector3(2, 2, 2), new Vector3(2, 2, 2));
      expect(box.isEmpty()).toBe(false);
    });
  });

  describe('expandByPoint', () => {
    test('empty box plus point becomes singular box', () => {
      const box = new Box();
      box.expandByPoint({ x: 1, y: 2, z: 3 });
      expectVec3Close(box.min, 1, 2, 3);
      expectVec3Close(box.max, 1, 2, 3);
      expect(box.isEmpty()).toBe(false);
    });

    test('grows existing box correctly', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      box.expandByPoint({ x: 5, y: -3, z: 2 });
      expectVec3Close(box.min, 0, -3, 0);
      expectVec3Close(box.max, 5, 1, 2);
    });

    test('out arg variant does not mutate this', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      const out = new Box();
      box.expandByPoint({ x: 5, y: 5, z: 5 }, out);
      expectVec3Close(box.min, 0, 0, 0);
      expectVec3Close(box.max, 1, 1, 1);
      expectVec3Close(out.min, 0, 0, 0);
      expectVec3Close(out.max, 5, 5, 5);
    });
  });

  describe('union', () => {
    test('non-overlapping boxes yield bounding hull', () => {
      const a = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      const b = new Box(new Vector3(5, 5, 5), new Vector3(6, 6, 6));
      a.union(b);
      expectVec3Close(a.min, 0, 0, 0);
      expectVec3Close(a.max, 6, 6, 6);
    });

    test('out arg variant does not mutate this', () => {
      const a = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      const b = new Box(new Vector3(5, 5, 5), new Vector3(6, 6, 6));
      const out = new Box();
      a.union(b, out);
      expectVec3Close(a.min, 0, 0, 0);
      expectVec3Close(a.max, 1, 1, 1);
      expectVec3Close(out.min, 0, 0, 0);
      expectVec3Close(out.max, 6, 6, 6);
    });
  });

  describe('getCenter', () => {
    test('empty box returns (0, 0, 0)', () => {
      const center = new Box().getCenter();
      expectVec3Close(center, 0, 0, 0);
    });

    test('non-empty box returns midpoint', () => {
      const box = new Box(new Vector3(0, -2, 4), new Vector3(2, 4, 8));
      const center = box.getCenter();
      expectVec3Close(center, 1, 1, 6);
    });

    test('writes into out arg when provided', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(2, 2, 2));
      const out = new Vector3();
      const result = box.getCenter(out);
      expect(result).toBe(out);
      expectVec3Close(out, 1, 1, 1);
    });
  });

  describe('getSize', () => {
    test('empty box returns (0, 0, 0)', () => {
      const size = new Box().getSize();
      expectVec3Close(size, 0, 0, 0);
    });

    test('non-empty box returns max - min', () => {
      const box = new Box(new Vector3(-1, -2, -3), new Vector3(4, 5, 6));
      const size = box.getSize();
      expectVec3Close(size, 5, 7, 9);
    });

    test('writes into out arg when provided', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(3, 4, 5));
      const out = new Vector3();
      const result = box.getSize(out);
      expect(result).toBe(out);
      expectVec3Close(out, 3, 4, 5);
    });
  });

  describe('distanceToPoint', () => {
    test('point inside box returns 0', () => {
      const box = new Box(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      expect(box.distanceToPoint({ x: 0.5, y: 0, z: -0.3 })).toBeCloseTo(0, 5);
    });

    test('point on boundary returns 0', () => {
      const box = new Box(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      expect(box.distanceToPoint({ x: 1, y: 0, z: 0 })).toBeCloseTo(0, 5);
    });

    test('point outside returns distance to closest face', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      expect(box.distanceToPoint({ x: 3, y: 0.5, z: 0.5 })).toBeCloseTo(2, 5);
    });

    test('point beyond a corner returns the Euclidean distance to that corner', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      expect(box.distanceToPoint({ x: 4, y: 5, z: 13 })).toBeCloseTo(13, 5);
    });
  });

  describe('clampPoint', () => {
    test('point inside returns same point', () => {
      const box = new Box(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      const clamped = box.clampPoint({ x: 0.5, y: 0, z: -0.3 });
      expectVec3Close(clamped, 0.5, 0, -0.3);
    });

    test('point outside is clamped to box surface', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      const clamped = box.clampPoint({ x: 5, y: -3, z: 0.5 });
      expectVec3Close(clamped, 1, 0, 0.5);
    });

    test('writes into out arg when provided', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      const out = new Vector3();
      const result = box.clampPoint({ x: 5, y: 5, z: 5 }, out);
      expect(result).toBe(out);
      expectVec3Close(out, 1, 1, 1);
    });
  });

  describe('containsPoint', () => {
    test('inside is true', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      expect(box.containsPoint({ x: 0.5, y: 0.5, z: 0.5 })).toBe(true);
    });

    test('boundary is inclusive', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      expect(box.containsPoint({ x: 0, y: 0, z: 0 })).toBe(true);
      expect(box.containsPoint({ x: 1, y: 1, z: 1 })).toBe(true);
      expect(box.containsPoint({ x: 1, y: 0.5, z: 0.5 })).toBe(true);
    });

    test('outside is false', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      expect(box.containsPoint({ x: 1.001, y: 0.5, z: 0.5 })).toBe(false);
      expect(box.containsPoint({ x: 0.5, y: -0.001, z: 0.5 })).toBe(false);
      expect(box.containsPoint({ x: 0.5, y: 0.5, z: 2 })).toBe(false);
    });
  });

  describe('containsBox', () => {
    test('fully contained boxes return true', () => {
      const outer = new Box(new Vector3(0, 0, 0), new Vector3(10, 10, 10));
      const inner = new Box(new Vector3(2, 2, 2), new Vector3(8, 8, 8));
      expect(outer.containsBox(inner)).toBe(true);
    });

    test('boundary is inclusive (equal boxes)', () => {
      const a = new Box(new Vector3(0, 0, 0), new Vector3(10, 10, 10));
      const b = new Box(new Vector3(0, 0, 0), new Vector3(10, 10, 10));
      expect(a.containsBox(b)).toBe(true);
    });

    test('partial overlap returns false', () => {
      const a = new Box(new Vector3(0, 0, 0), new Vector3(5, 5, 5));
      const b = new Box(new Vector3(3, 3, 3), new Vector3(8, 8, 8));
      expect(a.containsBox(b)).toBe(false);
    });

    test('empty box is contained by any non-empty box (empty min > max trivially satisfies condition)', () => {
      const outer = new Box(new Vector3(0, 0, 0), new Vector3(10, 10, 10));
      const empty = new Box();
      expect(outer.containsBox(empty)).toBe(true);
    });
  });

  describe('intersectsBox', () => {
    test('overlapping boxes intersect', () => {
      const a = new Box(new Vector3(0, 0, 0), new Vector3(2, 2, 2));
      const b = new Box(new Vector3(1, 1, 1), new Vector3(3, 3, 3));
      expect(a.intersectsBox(b)).toBe(true);
    });

    test('touching boxes intersect (boundaries inclusive)', () => {
      const a = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      const b = new Box(new Vector3(1, 0, 0), new Vector3(2, 1, 1));
      expect(a.intersectsBox(b)).toBe(true);
    });

    test('separated on a single axis returns false', () => {
      const a = new Box(new Vector3(0, 0, 0), new Vector3(1, 10, 10));
      const b = new Box(new Vector3(2, 0, 0), new Vector3(3, 10, 10));
      expect(a.intersectsBox(b)).toBe(false);
    });
  });

  describe('intersectsSphere', () => {
    test('sphere touching box face intersects', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      const sphere = new Sphere(new Vector3(2, 0.5, 0.5), 1);
      expect(box.intersectsSphere(sphere)).toBe(true);
    });

    test('sphere outside box does not intersect', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      const sphere = new Sphere(new Vector3(5, 5, 5), 1);
      expect(box.intersectsSphere(sphere)).toBe(false);
    });

    test('negative-radius (empty) sphere returns false', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(10, 10, 10));
      const sphere = new Sphere(new Vector3(5, 5, 5), -1);
      expect(box.intersectsSphere(sphere)).toBe(false);
    });
  });

  describe('intersectsPlane', () => {
    test('plane straddling box intersects', () => {
      const planeAtYHalf = new Plane(new Vector3(0, 1, 0), -0.5);
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      expect(box.intersectsPlane(planeAtYHalf)).toBe(true);
    });

    test('plane outside box does not intersect', () => {
      const planeAtY5 = new Plane(new Vector3(0, 1, 0), -5);
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      expect(box.intersectsPlane(planeAtY5)).toBe(false);
    });

    test('plane tangent to box face intersects', () => {
      const planeAtY1 = new Plane(new Vector3(0, 1, 0), -1);
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      expect(box.intersectsPlane(planeAtY1)).toBe(true);
    });

    test('handles negative normal components', () => {
      const planeAtXHalfFacingMinusX = new Plane(new Vector3(-1, 0, 0), 0.5);
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      expect(box.intersectsPlane(planeAtXHalfFacingMinusX)).toBe(true);
    });
  });

  describe('intersectsRay', () => {
    test('delegates to ray.intersectsBox (hit case)', () => {
      const box = new Box(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
      const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
      expect(box.intersectsRay(ray)).toBe(true);
      expect(box.intersectsRay(ray)).toBe(ray.intersectsBox(box));
    });
  });

  describe('applyMatrix4', () => {
    test('translation matrix translates corners', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      const m = new Matrix4().makeTranslation(2, 3, 4);
      box.applyMatrix4(m);
      expectVec3Close(box.min, 2, 3, 4);
      expectVec3Close(box.max, 3, 4, 5);
    });

    test('a 45° turn about Y grows the X and Z half-extents of a unit cube to half its face diagonal', () => {
      const box = new Box(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));
      const m = new Matrix4().makeRotationY(Math.PI / 4);
      box.applyMatrix4(m);
      const expectedExtent = Math.sqrt(0.5);
      expect(box.min.x).toBeCloseTo(-expectedExtent, 5);
      expect(box.max.x).toBeCloseTo(expectedExtent, 5);
      expect(box.min.y).toBeCloseTo(-0.5, 5);
      expect(box.max.y).toBeCloseTo(0.5, 5);
      expect(box.min.z).toBeCloseTo(-expectedExtent, 5);
      expect(box.max.z).toBeCloseTo(expectedExtent, 5);
    });

    test('empty box stays empty', () => {
      const box = new Box();
      const m = new Matrix4().makeTranslation(2, 3, 4);
      box.applyMatrix4(m);
      expect(box.isEmpty()).toBe(true);
    });

    test('out arg variant does not mutate this', () => {
      const box = new Box(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
      const m = new Matrix4().makeTranslation(2, 3, 4);
      const out = new Box();
      box.applyMatrix4(m, out);
      expectVec3Close(box.min, 0, 0, 0);
      expectVec3Close(box.max, 1, 1, 1);
      expectVec3Close(out.min, 2, 3, 4);
      expectVec3Close(out.max, 3, 4, 5);
    });

    test('reentrant-safe (in-place vs out-arg agree)', () => {
      const box1 = new Box(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));
      const box2 = box1.clone();
      const out = new Box();
      const m = new Matrix4().makeRotationY(Math.PI / 4);

      box1.applyMatrix4(m);
      box2.applyMatrix4(m, out);

      expect(box1.min.x).toBeCloseTo(out.min.x, 5);
      expect(box1.min.y).toBeCloseTo(out.min.y, 5);
      expect(box1.min.z).toBeCloseTo(out.min.z, 5);
      expect(box1.max.x).toBeCloseTo(out.max.x, 5);
      expect(box1.max.y).toBeCloseTo(out.max.y, 5);
      expect(box1.max.z).toBeCloseTo(out.max.z, 5);
    });
  });

  describe('getBounds', () => {
    test('returns a copy of self', () => {
      const box = new Box(new Vector3(1, 2, 3), new Vector3(4, 5, 6));
      const bounds = box.getBounds();
      expect(bounds).not.toBe(box);
      expect(bounds.equals(box)).toBe(true);
    });

    test('writes into out arg when provided', () => {
      const box = new Box(new Vector3(1, 2, 3), new Vector3(4, 5, 6));
      const out = new Box();
      const result = box.getBounds(out);
      expect(result).toBe(out);
      expect(out.equals(box)).toBe(true);
    });
  });

  describe('width / height / depth', () => {
    test('return per-axis extents', () => {
      const box = new Box(new Vector3(-1, -2, -3), new Vector3(4, 5, 6));
      expect(box.width).toBeCloseTo(5, 5);
      expect(box.height).toBeCloseTo(7, 5);
      expect(box.depth).toBeCloseTo(9, 5);
    });
  });
});
