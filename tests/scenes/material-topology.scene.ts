import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: {
    backgroundColor: 0x000000,
  },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    app.stage.addChild(view3d);

    const cube = new Mesh3D({
      geometry: new CubeGeometry({
        width: 1.6,
        height: 1.6,
        depth: 1.6,
      }),
      material: new FlatMaterial({
        baseColor: 0xffffff,
        topology: 'line-list',
      }),
      castShadow: false,
      receiveShadow: false,
    });

    cube.rotation.set(-0.4, 0.6, 0.1);

    view3d.root.addChild(cube);

    view3d.camera.position.set(0, 0, 2.5);
  },
};
