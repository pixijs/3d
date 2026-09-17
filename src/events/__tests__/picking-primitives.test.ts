// Every built-in primitive geometry should pick with hitVolume='geometry'. One
// case per primitive, so a failure names the shape that broke.
import { Rectangle } from 'pixi.js';
import { describe, expect, test } from 'vitest';

import { updateCameraProjectionForView } from '~/core/prepareCamera';
import { ConeGeometry } from '~/geometry/ConeGeometry';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { CylinderGeometry } from '~/geometry/CylinderGeometry';
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

const PRIMITIVES = [
  { name: 'Cube', make: () => new CubeGeometry({ width: 1, height: 1, depth: 1 }) },
  { name: 'Sphere', make: () => new SphereGeometry({ radius: 0.5, widthSegments: 24, heightSegments: 16 }) },
  {
    name: 'Cylinder',
    make: () => new CylinderGeometry({ radiusTop: 0.4, radiusBottom: 0.4, height: 1, radialSegments: 24 }),
  },
  { name: 'Cone', make: () => new ConeGeometry({ radius: 0.5, height: 1, radialSegments: 24 }) },
];

for (const prim of PRIMITIVES) {
  describe(`${prim.name} — hitVolume='geometry'`, () => {
    test('viewport-center ray hits the mesh', () => {
      const view3d = new View3D({ ...SIZE });
      view3d.camera.position.set(0, 0, 8);
      view3d.camera.usePerspective(45, 0.1, 1000);

      const mesh = new Mesh3D({ geometry: prim.make(), material: new Material3D({}) });
      mesh.interactive = true;
      mesh.hitVolume = 'geometry';
      view3d.root.addChild(mesh);
      tick(view3d);

      const hit = view3d.raycast({ x: 50, y: 50 });
      expect(hit?.target, `${prim.name} center pick`).toBe(mesh);
    });
  });
}
