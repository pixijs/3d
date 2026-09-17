import type { TestScene } from '@test-utils';

import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: {
    backgroundColor: 0x202020,
  },
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      toneMapping: 'none',
      environment: { skyColor: 0x2288ff, groundColor: 0xaa3300, intensity: Math.PI },
    });

    app.stage.addChild(view3d);

    const sphere = new Mesh3D({
      geometry: new SphereGeometry({ radius: 0.95, widthSegments: 32, heightSegments: 16 }),
      material: new Material3D({ baseColor: 0xffffff, metallic: 0, roughness: 1 }),
      castShadow: false,
      receiveShadow: false,
    });

    view3d.root.addChild(sphere);

    view3d.camera.position.set(0, 0, 2.5);
  },
};
