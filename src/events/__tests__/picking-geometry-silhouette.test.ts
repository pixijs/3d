import { Rectangle } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import { updateCameraProjectionForView } from '~/core/prepareCamera';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
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

    const throughBoxCornerOutsideSphere = { x: 61, y: 39 };

    sphere.hitVolume = 'box';
    const boxHit = view3d.raycast(throughBoxCornerOutsideSphere);
    sphere.hitVolume = 'geometry';
    const geomHit = view3d.raycast(throughBoxCornerOutsideSphere);

    expect(boxHit?.target).toBe(sphere);
    expect(geomHit).toBeNull();
  });
});

describe("Mesh3D with hitVolume='geometry' — against an earlier, farther hit", () => {
  test('a geometry whose bounds hold the camera still hits in front of a box picked before it', () => {
    const view3d = new View3D({ ...SIZE });
    view3d.camera.position.set(0, 0, 10);
    view3d.camera.usePerspective(45, 0.1, 1000);

    const box = new Mesh3D({ geometry: new CubeGeometry(), material: new Material3D({}) });
    box.interactive = true;
    view3d.root.addChild(box);

    const room = new Mesh3D({
      geometry: new Geometry3D({
        positions: new Float32Array([
          -1, -1, 5, 1, -1, 5, 0, 1, 5, -30, -30, -20, 30, -30, -20, 0, 30, -20, -30, -30, 20, 30, -30, 20, 0, 30, 20,
        ]),
      }),
      material: new Material3D({}),
    });
    room.interactive = true;
    room.hitVolume = 'geometry';
    view3d.root.addChild(room);
    tick(view3d);

    const hit = view3d.raycast({ x: 50, y: 50 });

    expect(hit?.target).toBe(room);
    expect(hit?.distance).toBeCloseTo(5);
  });
});
