import type { TestScene } from '@test-utils';

import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import { createMorphGrid } from './helpers/morphGrid';

/**
 * A morphed grid at a fixed blend of both targets: the surface shows the
 * peak + ramp on both backends (each keeps its own reference image).
 */
export const scene: TestScene = {
  app: {
    backgroundColor: 0xf4f1ea,
  },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    const mesh = new Mesh3D({
      geometry: createMorphGrid(),
      material: new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.5, doubleSided: true }),
      castShadow: false,
      receiveShadow: false,
      weights: new Float32Array([1, 0.15]),
    });
    view3d.root.addChild(mesh);

    const light = new DirectionalLight({ color: 0xffffff, intensity: 9 });
    light.rotation.set(0.18, 0.12, 0);
    view3d.root.addChild(light);

    view3d.camera.position.set(0, 0, 2.6);
  },
};
