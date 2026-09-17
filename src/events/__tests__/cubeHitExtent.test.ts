// `'geometry'` picking on a cube should reach the full AABB, since the cube's
// triangles tile that AABB exactly.
import { describe, expect, test } from 'vitest';

import { createHitResult3D } from '~/events/HitResult3D';
import { intersectRayGeometry } from '~/events/intersectRayGeometry';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Ray } from '~/math/shapes/Ray';
import { Vector3 } from '~/math/vector/Vector3';

describe('Cube — geometry hit covers the full AABB extent', () => {
  const cube = new CubeGeometry({ width: 1.2, height: 1.2, depth: 1.2 });

  // Probe points spread across the AABB of a 1.2-unit cube centred at origin.
  // Its half-extent is 0.6, so 0.55 sits just inside a face, and the corner
  // pairs still fall on the cube because its silhouette is that square.
  const points: Array<[number, number, string]> = [
    [0, 0, 'centre'],
    [0.55, 0, 'right edge (inside +X face)'],
    [-0.55, 0, 'left edge'],
    [0, 0.55, 'top edge'],
    [0, -0.55, 'bottom edge'],
    [0.55, 0.55, 'top-right corner'],
    [-0.55, -0.55, 'bottom-left corner'],
    [0.55, -0.55, 'bottom-right corner'],
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
