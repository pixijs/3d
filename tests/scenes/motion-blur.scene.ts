import type { TestScene } from '@test-utils';

import { MotionBlurEffect } from '~/extras/post-processing/effects/MotionBlurEffect';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: {
    width: 256,
    height: 256,
    backgroundColor: 0x1b2230,
    autoStart: false,
  },
  create: async (app) => {
    const view = new View3D({
      width: 256,
      height: 256,
      environment: { skyColor: 0xdfe8f2, groundColor: 0x30281f },
      passes: [new MotionBlurEffect({ intensity: 1, samples: 16 })],
    });
    app.stage.addChild(view);

    view.camera.fov = 50;
    view.camera.position.set(0, 1.5, 6);
    view.camera.lookAt({ x: 0, y: 0.5, z: 0 });

    const light = new Material3D({ baseColor: 0xe8e2d4 });
    const dark = new Material3D({ baseColor: 0x2b6cb0 });
    const tile = new PlaneGeometry({ width: 1, height: 1 });
    for (let x = -6; x < 6; x++) {
      for (let z = -6; z < 4; z++) {
        const t = new Mesh3D({ geometry: tile, material: (x + z) & 1 ? light : dark });
        t.rotation.set(-Math.PI / 2, 0, 0);
        t.position.set(x + 0.5, 0, z + 0.5);
        view.root.addChild(t);
      }
    }

    const block = new CubeGeometry({ width: 0.6, height: 0.5, depth: 0.6 });
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 4; j++) {
        const b = new Mesh3D({ geometry: block, material: j & 1 ? dark : light });
        b.position.set(-3 + i * 1.5, 0.25 + j * 0.5, -1.5);
        view.root.addChild(b);
      }
    }

    const ball = new Mesh3D({
      geometry: new SphereGeometry({ radius: 0.6 }),
      material: new Material3D({ baseColor: 0xe0533d }),
    });
    ball.position.set(0.8, 0.6, 1);
    view.root.addChild(ball);

    app.render();

    view.camera.lookAt({ x: 0.35, y: 0.5, z: 0 });
  },
};
