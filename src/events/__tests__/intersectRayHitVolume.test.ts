import { describe, expect, test } from 'vitest';

import { createHitResult3D } from '~/events/HitResult3D';
import { intersectRayHitVolume } from '~/events/intersectRayHitVolume';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Box } from '~/math/shapes/Box';
import { Ray } from '~/math/shapes/Ray';
import { Sphere } from '~/math/shapes/Sphere';
import { Vector3 } from '~/math/vector/Vector3';

// Unit box centred on the origin, so every face sits at ±1 and hit distances stay exact.
function unitBox(): Box {
  return new Box(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
}

// Quad in the XY plane from (-1,-1) to (1,1), normal +Z.
function makeQuad(): Geometry3D {
  return new Geometry3D({
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  });
}

describe('intersectRayHitVolume', () => {
  describe('Box', () => {
    test('reports the exact distance to the entry face', () => {
      const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
      const hit = createHitResult3D();

      // Entry face at z = 1, so the ray travels exactly 4 units.
      expect(intersectRayHitVolume(ray, unitBox(), hit)).toBe(4);
      expect(hit.distance).toBe(4);
      expect(hit.point.z).toBe(1);
    });

    test('reports the exact distance along a diagonal ray', () => {
      const d = Math.SQRT1_2;
      const ray = new Ray(new Vector3(-5, -5, 0), new Vector3(d, d, 0));
      const hit = createHitResult3D();

      // Enters at (-1, -1, 0): 4 units on each of x and y, so 4 * sqrt(2) along the ray.
      expect(intersectRayHitVolume(ray, unitBox(), hit)).toBeCloseTo(4 * Math.SQRT2, 6);
      expect(hit.distance).toBeCloseTo(4 * Math.SQRT2, 6);
      expect(hit.point.x).toBeCloseTo(-1, 6);
      expect(hit.point.y).toBeCloseTo(-1, 6);
    });

    test('reports the distance to the EXIT face when the origin is inside', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const hit = createHitResult3D();

      // Inside the volume there is no forward entry face, so the hit is the exit at z = -1.
      expect(intersectRayHitVolume(ray, unitBox(), hit)).toBe(1);
      expect(hit.distance).toBe(1);
      expect(hit.point.z).toBe(-1);
    });

    test('leaves normal / uv zeroed and triangleIndex at -1', () => {
      const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
      const hit = createHitResult3D();

      intersectRayHitVolume(ray, unitBox(), hit);

      expect(hit.triangleIndex).toBe(-1);
      expect(hit.normal.x).toBe(0);
      expect(hit.normal.y).toBe(0);
      expect(hit.normal.z).toBe(0);
      expect(hit.uv.x).toBe(0);
      expect(hit.uv.y).toBe(0);
    });

    test('returns -1 and leaves the buffer untouched on a miss', () => {
      const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, 1));
      const hit = createHitResult3D();

      expect(intersectRayHitVolume(ray, unitBox(), hit)).toBe(-1);
      expect(hit.distance).toBe(-1);
    });
  });

  describe('Sphere', () => {
    test('reports the exact distance to the entry point', () => {
      const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
      const hit = createHitResult3D();

      // Entry at z = 1 on a unit sphere at the origin: 4 units of travel.
      expect(intersectRayHitVolume(ray, new Sphere(new Vector3(0, 0, 0), 1), hit)).toBe(4);
      expect(hit.distance).toBe(4);
      expect(hit.point.z).toBe(1);
    });

    test('reports the distance to the EXIT point when the origin is inside', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const hit = createHitResult3D();

      expect(intersectRayHitVolume(ray, new Sphere(new Vector3(0, 0, 0), 2), hit)).toBe(2);
      expect(hit.distance).toBe(2);
      expect(hit.point.z).toBe(-2);
    });

    test('leaves normal / uv zeroed and triangleIndex at -1', () => {
      const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
      const hit = createHitResult3D();

      intersectRayHitVolume(ray, new Sphere(new Vector3(0, 0, 0), 1), hit);

      expect(hit.triangleIndex).toBe(-1);
      expect(hit.normal.z).toBe(0);
      expect(hit.uv.x).toBe(0);
      expect(hit.uv.y).toBe(0);
    });

    test('returns -1 and leaves the buffer untouched on a miss', () => {
      const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
      const hit = createHitResult3D();

      expect(intersectRayHitVolume(ray, new Sphere(new Vector3(10, 0, 0), 1), hit)).toBe(-1);
      expect(hit.distance).toBe(-1);
    });
  });

  describe('Geometry3D', () => {
    test('populates surface data and a real triangle index', () => {
      const ray = new Ray(new Vector3(0.5, -0.5, 5), new Vector3(0, 0, -1));
      const hit = createHitResult3D();

      expect(intersectRayHitVolume(ray, makeQuad(), hit)).toBeCloseTo(5, 6);
      expect(hit.triangleIndex).not.toBe(-1);
      expect(hit.normal.z).toBeCloseTo(1, 6);
    });
  });

  // Box and Geometry3D report the same quantity — the parametric `t` — so hits stay comparable across
  // volumes on one ray. A non-unit direction is where `t` and the Euclidean distance part company: the
  // ray below reaches the box face at t = 2 having travelled 4 units. (Sphere is excluded: its solve
  // assumes a unit-length direction, as `Ray.intersectSphereT` documents.)
  test('reports parametric t, not Euclidean distance, for a non-unit direction', () => {
    const ray = new Ray(new Vector3(0.5, -0.5, 5), new Vector3(0, 0, -2));
    const hit = createHitResult3D();

    expect(intersectRayHitVolume(ray, unitBox(), hit)).toBe(2);
    expect(hit.point.z).toBe(1);

    // The Möller-Trumbore path is parametric too; the quad sits at z = 0, one unit further.
    expect(intersectRayHitVolume(ray, makeQuad(), hit)).toBeCloseTo(2.5, 6);
    expect(hit.point.z).toBeCloseTo(0, 6);
  });
});
