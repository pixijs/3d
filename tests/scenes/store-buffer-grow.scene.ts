import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

// GRID_SIZE = 29 places 841 meshes in the scene batch, one more than the
// 819-slot capacity left by `DataStoreBuffer._expand`'s texture-row
// alignment with stride 20. This forces the second grow boundary and
// catches regressions of the slot-overflow bug (issue #140).
const GRID_SIZE = 29;
const SPACING = 0.5;
const CUBE_SIZE = 0.35;

export const scene: TestScene = {
  app: {
    backgroundColor: 0xf4f1ea,
  },
  pixelMatch: 60,
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    const geometry = new CubeGeometry({ width: CUBE_SIZE, height: CUBE_SIZE, depth: CUBE_SIZE });
    const half = ((GRID_SIZE - 1) * SPACING) / 2;
    const total = GRID_SIZE * GRID_SIZE;

    for (let i = 0; i < total; i++) {
      const col = i % GRID_SIZE;
      const row = Math.floor(i / GRID_SIZE);
      const r = Math.floor((col / (GRID_SIZE - 1)) * 220) + 20;
      const g = Math.floor((row / (GRID_SIZE - 1)) * 220) + 20;
      const b = Math.floor(((col + row) / (2 * (GRID_SIZE - 1))) * 220) + 20;

      const mesh = new Mesh3D({
        geometry,
        material: new Material3D({ baseColor: (r << 16) | (g << 8) | b, metallic: 0, roughness: 0.55 }),
        castShadow: false,
        receiveShadow: false,
      });
      mesh.position.set(col * SPACING - half, 0, row * SPACING - half);
      view3d.root.addChild(mesh);
    }

    const light = new DirectionalLight({ color: 0xffffff, intensity: 6 });
    light.rotation.set(-0.85, 0.55, 0.25);
    view3d.root.addChild(light);

    view3d.camera.position.set(0, 9, 14);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  },
};
