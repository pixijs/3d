import type { TestScene } from '@test-utils';

import { TintEffect } from '~/extras/post-processing/effects/TintEffect';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 200;

export const scene: TestScene = {
  app: {
    width: 340,
    height: 260,
    backgroundColor: 0x10141a,
    antialias: true,
    resolution: 1,
  },
  delay: 120,
  create: async (app) => {
    const view = new View3D({
      width: SIZE,
      height: SIZE,
      anchor: 0.5,
      toneMapping: 'none',
      environment: { skyColor: 0x334455, groundColor: 0x111111 },
      passes: [new TintEffect({ tint: 0xffe0c0 })],
    });
    view.camera.fov = 40;
    view.camera.position.set(0, 1.2, 6);
    view.camera.lookAt({ x: 0, y: 0, z: 0 });

    view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.3 }));
    const sun = new DirectionalLight({ color: 0xffffff, intensity: 2 });
    sun.position.set(3, 5, 4);
    sun.lookAt({ x: 0, y: 0, z: 0 });
    view.root.addChild(sun);

    const bar = new Material3D({ baseColor: 0xe8ecf0, roughness: 0.5 });
    for (let i = 0; i < 7; i++) {
      const mesh = new Mesh3D({ geometry: new CubeGeometry({ width: 0.06, height: 2.6, depth: 0.06 }), material: bar });
      mesh.position.set(-1.8 + i * 0.6, 0.2, -0.5);
      mesh.rotation.set(0, 0, 0.12 * (i - 3));
      view.root.addChild(mesh);
    }

    const ball = new Mesh3D({
      geometry: new SphereGeometry({ radius: 0.55, widthSegments: 12, heightSegments: 8 }),
      material: new Material3D({ baseColor: 0xd08040, roughness: 0.4 }),
    });
    ball.position.set(1.1, -0.6, 0.6);
    view.root.addChild(ball);

    const glass = new Mesh3D({
      geometry: new CubeGeometry({ width: 1.6, height: 1.2, depth: 0.15 }),
      material: new Material3D({ transmission: { factor: 1, thickness: 0.4 }, ior: 1.5, roughness: 0.15 }),
    });
    glass.position.set(-0.8, -0.4, 1.2);
    glass.rotation.set(0, 0.35, 0.2);
    view.root.addChild(glass);

    view.position.set(170, 130);
    app.stage.addChild(view);
  },
};
