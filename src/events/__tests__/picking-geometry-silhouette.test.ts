// Full-stack check: a Mesh3D with `hitVolume = 'geometry'` should respect its
// silhouette, not its AABB.
import { Rectangle } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import { updateCameraProjectionForView } from '~/core/prepareCamera';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { updateView3DTransforms } from '~/scene/utils/updateView3DTransforms';
import { View3D } from '~/scene/View3D';

const SIZE = { width: 100, height: 100 };
const SCREEN = new Rectangle(0, 0, SIZE.width, SIZE.height);

function tick(view3d: View3D): void {
  const cam = view3d.camera;
  cam.localTransform.compose(cam.position, cam.quaternion, cam.scale);
  cam.worldTransform.copyFrom(cam.localTransform);
  updateCameraProjectionForView(view3d, view3d.camera, SCREEN, { x: 0, y: 0 });
  updateView3DTransforms(view3d);
}

describe("Mesh3D with hitVolume='geometry' — silhouette respect end-to-end", () => {
  test("'box' mode hits the AABB corner of a sphere; 'geometry' mode misses it", () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    view3d.camera.usePerspective(45, 0.1, 1000);

    const sphere = new Mesh3D({
      geometry: new SphereGeometry({ radius: 1, widthSegments: 32, heightSegments: 16 }),
      material: new Material3D({}),
    });
    sphere.interactive = true;
    view3d.root.addChild(sphere);
    tick(view3d);

    // With camera (0, 0, 10), FOV 45°, sphere radius 1 at origin, the unit
    // sphere covers roughly viewport-x ∈ [37, 63] in a 100×100 view (because
    // 1/10 = tan of subtended half-angle ≈ 11.4°, which is ~25% of the 45°
    // vertical FOV). Pixel (61, 39) projects to a world ray that passes
    // through the AABB corner (~ world (0.86, 0.86, …)) — inside the box,
    // outside the silhouette circle (length ≈ 1.21 > 1).

    sphere.hitVolume = 'box';
    const boxHit = view3d.raycast({ x: 61, y: 39 });
    sphere.hitVolume = 'geometry';
    const geomHit = view3d.raycast({ x: 61, y: 39 });

    expect(boxHit?.target).toBe(sphere); // the AABB corner counts as a hit
    expect(geomHit).toBeNull(); // the same ray misses the silhouette circle
  });

  test('center pick lands on the sphere in both modes', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    view3d.camera.usePerspective(45, 0.1, 1000);

    const sphere = new Mesh3D({
      geometry: new SphereGeometry({ radius: 1, widthSegments: 32, heightSegments: 16 }),
      material: new Material3D({}),
    });
    sphere.interactive = true;
    view3d.root.addChild(sphere);
    tick(view3d);

    sphere.hitVolume = 'box';
    expect(view3d.raycast({ x: 50, y: 50 })?.target).toBe(sphere);

    sphere.hitVolume = 'geometry';
    expect(view3d.raycast({ x: 50, y: 50 })?.target).toBe(sphere);
  });
});
