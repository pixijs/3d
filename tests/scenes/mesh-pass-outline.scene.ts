import type { TestScene } from '@test-utils';

import { OutlinePass } from '~/extras/post-processing/passes/OutlinePass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 220;

export const scene: TestScene = {
  app: {
    width: 340,
    height: 260,
    backgroundColor: 0xe8eef4,
  },
  delay: 120,
  create: async (app) => {
    const view = new View3D({
      width: 320,
      height: SIZE,
      anchor: 0.5,
      toneMapping: 'none',
      environment: { skyColor: 0xffffff, groundColor: 0x334455 },
      passes: [new OutlinePass({ width: 0.06, color: 0x1a0f33 })],
    });
    view.camera.fov = 40;
    view.camera.position.set(0, 1.4, 5.4);
    view.camera.lookAt({ x: 0, y: 0.1, z: 0 });

    view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.4 }));
    const key = new DirectionalLight({ color: 0xffffff, intensity: 3 });
    key.position.set(3, 5, 4);
    key.lookAt({ x: 0, y: 0, z: 0 });
    view.root.addChild(key);

    const inked = new Material3D({ baseColor: 0xff7733, roughness: 0.55, passes: { outline: true } });
    const plain = new Material3D({ baseColor: 0x4488ff, roughness: 0.55 });

    const sphere = new Mesh3D({ geometry: new SphereGeometry({ radius: 0.7 }), material: inked });
    sphere.position.set(-1.5, 0.1, 0);
    view.root.addChild(sphere);

    const cube = new Mesh3D({ geometry: new CubeGeometry({ width: 1.1, height: 1.1, depth: 1.1 }), material: inked });
    cube.rotation.set(0.35, 0.6, 0);
    cube.position.set(0.1, 0.1, 0);
    view.root.addChild(cube);

    const bare = new Mesh3D({ geometry: new SphereGeometry({ radius: 0.7 }), material: plain });
    bare.position.set(1.7, 0.1, 0);
    view.root.addChild(bare);

    view.position.set(170, 130);
    app.stage.addChild(view);
  },
};
