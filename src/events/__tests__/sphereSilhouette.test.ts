// 'geometry' picking follows a sphere's silhouette, not the AABB around it.
import { describe, expect, test } from 'vitest';

import { createHitResult3D } from '~/events/HitResult3D';
import { intersectRayGeometry } from '~/events/intersectRayGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Ray } from '~/math/shapes/Ray';
import { Vector3 } from '~/math/vector/Vector3';

describe('SphereGeometry — silhouette respect', () => {
  test('ray through AABB corner of unit sphere should miss the surface', () => {
    const sphere = new SphereGeometry({ radius: 1, widthSegments: 32, heightSegments: 16 });
    // Ray from (0.95, 0.95, 5) → -Z. At z=0 it's at (0.95, 0.95) — inside the
    // unit AABB ([-1, 1]^3) but well outside the unit sphere (length ≈ 1.34).
    const ray = new Ray(new Vector3(0.95, 0.95, 5), new Vector3(0, 0, -1));
    const hit = createHitResult3D();

    const t = intersectRayGeometry(ray, sphere, hit);

    expect(t).toBe(-1);
  });

  test('ray through center of unit sphere SHOULD hit the surface', () => {
    const sphere = new SphereGeometry({ radius: 1, widthSegments: 32, heightSegments: 16 });
    const ray = new Ray(new Vector3(0, 0, 5), new Vector3(0, 0, -1));
    const hit = createHitResult3D();

    const t = intersectRayGeometry(ray, sphere, hit);

    // Front of sphere at z=1, ray origin at z=5 → t≈4.
    expect(t).toBeGreaterThan(0);
    expect(t).toBeCloseTo(4, 1);
  });
});
