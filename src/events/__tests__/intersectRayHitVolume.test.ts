import { describe, expect, test } from 'vitest';

import { createHitResult3D } from '~/events/HitResult3D';
import { intersectRayHitVolume } from '~/events/intersectRayHitVolume';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Box } from '~/math/shapes/Box';
import { Ray } from '~/math/shapes/Ray';
import { Sphere } from '~/math/shapes/Sphere';
import { Vector3 } from '~/math/vector/Vector3';

/** A 2×2×2 box centred on the origin, so every face sits at ±1 and hit distances come out exact */
function unitBox(): Box {
  return new Box(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
}

/** A two-triangle quad in the XY plane from (-1, -1) to (1, 1), wound to face +Z */
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

      expect(intersectRayHitVolume(ray, unitBox(), hit)).toBe(4);
      expect(hit.distance).toBe(4);
      expect(hit.point.z).toBe(1);
    });

    test('reports the distance to the EXIT face when the origin is inside', () => {
      const ray = new Ray(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
      const hit = createHitResult3D();

      expect(intersectRayHitVolume(ray, unitBox(), hit)).toBe(1);
      expect(hit.distance).toBe(1);
      expect(hit.point.z).toBe(-1);
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
  });

  test('Box and Geometry3D report parametric t, not Euclidean distance, for a non-unit direction (Sphere requires a unit one)', () => {
    const ray = new Ray(new Vector3(0.5, -0.5, 5), new Vector3(0, 0, -2));
    const hit = createHitResult3D();

    expect(intersectRayHitVolume(ray, unitBox(), hit)).toBe(2);
    expect(hit.point.z).toBe(1);

    expect(intersectRayHitVolume(ray, makeQuad(), hit)).toBeCloseTo(2.5, 6);
    expect(hit.point.z).toBeCloseTo(0, 6);
  });
});
