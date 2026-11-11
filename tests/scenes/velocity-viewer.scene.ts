import type { TestScene } from '@test-utils';

import { VelocityViewer } from '~/extras/debug/VelocityViewer';
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
    backgroundColor: 0x000000,
    autoStart: false,
  },
  create: async (app) => {
    const view = new View3D({
      width: 256,
      height: 256,
      passes: [new VelocityViewer({ scale: 0.12 })],
    });
    app.stage.addChild(view);

    view.camera.fov = 50;
    view.camera.position.set(0, 1.5, 6);
    view.camera.lookAt({ x: 0, y: 0, z: 0 });

    const material = new Material3D({ baseColor: 0xffffff });

    const floor = new Mesh3D({ geometry: new PlaneGeometry({ width: 12, height: 12 }), material });
    floor.rotation.set(-Math.PI / 2, 0, 0);
    floor.position.set(0, -1, 0);
    view.root.addChild(floor);

    const near = new Mesh3D({ geometry: new SphereGeometry({ radius: 0.7 }), material });
    near.position.set(-1.2, -0.3, 2);
    view.root.addChild(near);

    const far = new Mesh3D({ geometry: new CubeGeometry({ width: 1.5, height: 3, depth: 1.5 }), material });
    far.position.set(1.5, 0.5, -3);
    view.root.addChild(far);

    app.render();

    view.camera.position.set(0.4, 1.8, 5.9);
    view.camera.lookAt({ x: 0, y: 0, z: 0 });
  },
};
