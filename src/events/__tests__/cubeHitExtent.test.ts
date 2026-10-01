import { describe, expect, test } from 'vitest';

import { createHitResult3D } from '~/events/HitResult3D';
import { intersectRayGeometry } from '~/events/intersectRayGeometry';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Ray } from '~/math/shapes/Ray';
import { Vector3 } from '~/math/vector/Vector3';

/** 0.05 inside the cube's 0.6 half-extent, so a probe at ±NEAR_CORNER sits just inside a corner of its front face */
const NEAR_CORNER = 0.55;

describe('a CubeGeometry hit covers its full AABB, which its triangles tile exactly', () => {
  const cube = new CubeGeometry({ width: 1.2, height: 1.2, depth: 1.2 });

  const points: Array<[number, number, string]> = [
    [NEAR_CORNER, NEAR_CORNER, 'top-right corner'],
    [-NEAR_CORNER, -NEAR_CORNER, 'bottom-left corner'],
    [NEAR_CORNER, -NEAR_CORNER, 'bottom-right corner'],
  ];

  for (const [x, y, name] of points) {
    test(`ray at (${x}, ${y}) from z=5 hits cube — ${name}`, () => {
      const ray = new Ray(new Vector3(x, y, 5), new Vector3(0, 0, -1));
      const hit = createHitResult3D();

      const t = intersectRayGeometry(ray, cube, hit);

      expect(t, `hit t for ${name}`).toBeGreaterThan(0);
    });
  }
});
