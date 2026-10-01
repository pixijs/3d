import type { TestScene } from '@test-utils';

import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import type { Hemisphere } from '~/scene/lights/environment/Hemisphere';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Exercises the Background pass drawing a {@link Hemisphere} gradient instead of a cubemap.
 *
 * One hemisphere is both the environment and the background, so the sphere's sky-lit top and
 * ground-lit bottom should match the sky above and the ground below it. The wide field of view
 * takes in most of the gradient, so the screenshot checks its orientation and blend on WebGL and
 * WebGPU.
 */
export const scene: TestScene = {
  app: {
    backgroundColor: 0x000000,
  },
  create: async (app) => {
    const hemisphere: Hemisphere = { skyColor: 0x3388ff, groundColor: 0xcc5522 };
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      environment: hemisphere,
      background: hemisphere,
    });
    app.stage.addChild(view3d);

    const sphere = new Mesh3D({
      geometry: new SphereGeometry({ radius: 0.8, widthSegments: 32, heightSegments: 16 }),
      material: new Material3D({ baseColor: 0xffffff, metallic: 0, roughness: 1 }),
      castShadow: false,
      receiveShadow: false,
    });
    view3d.root.addChild(sphere);

    view3d.camera.fov = 100;
    view3d.camera.position.set(0, 0.5, 3);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  },
};
