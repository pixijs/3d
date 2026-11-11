import type { TestScene } from '@test-utils';

import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: {
    backgroundColor: 0x1e2024,
  },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    const geometry = new Geometry3D({
      positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      morphTargets: [
        {
          positions: new Float32Array(12),
          normals: new Float32Array([-1.2, 0, -0.4, 1.2, 0, -0.4, 1.2, 0, -0.4, -1.2, 0, -0.4]),
        },
      ],
    });

    const mesh = new Mesh3D({
      geometry,
      material: new Material3D({ baseColor: 0xc8b89a, metallic: 0, roughness: 0.6 }),
      castShadow: false,
      receiveShadow: false,
      weights: new Float32Array([1]),
    });
    view3d.root.addChild(mesh);

    const light = new DirectionalLight({ color: 0xffffff, intensity: 8 });
    light.rotation.set(0, -1.1, 0);
    view3d.root.addChild(light);

    view3d.camera.position.set(0, 0, 2.8);
  },
};
