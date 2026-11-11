import { describe, expect, test } from 'vitest';

import { createHitResult3D } from '~/events/HitResult3D';
import { intersectRayHitVolume } from '~/events/intersectRayHitVolume';
import { Ray } from '~/math/shapes/Ray';
import { Sphere } from '~/math/shapes/Sphere';
import { Vector3 } from '~/math/vector/Vector3';

describe('intersectRayHitVolume', () => {
  describe('Sphere', () => {
    test('reports the exact distance to the entry point', () => {
      const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
      const hit = createHitResult3D();

      expect(intersectRayHitVolume(ray, new Sphere(new Vector3(0, 0, 0), 1), hit)).toBe(4);
      expect(hit.distance).toBe(4);
      expect(hit.point.z).toBe(1);
    });
  });
});
