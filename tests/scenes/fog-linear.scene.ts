import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const FOG_COLOR = 0xadb2ba;

export const scene: TestScene = {
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      background: FOG_COLOR,
      fog: { type: 'linear', color: FOG_COLOR, near: 2, far: 12 },
    });

    app.stage.addChild(view3d);

    const geometry = new CubeGeometry({ width: 0.7, height: 0.7, depth: 0.7 });
    const material = new Material3D({ baseColor: 0xc24d2c, metallic: 0, roughness: 0.6 });

    for (let i = 0; i < 8; i++) {
      const cube = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
      cube.position.set(0, 0, -i * 1.6);
      cube.rotation.set(-0.4, 0.6, 0.1);
      view3d.root.addChild(cube);
    }

    const light = new DirectionalLight({ color: 0xffffff, intensity: 6 });
    light.rotation.set(-0.65, 0.55, 0.25);
    view3d.root.addChild(light);

    view3d.camera.position.set(2, 1.2, 2);
    view3d.camera.lookAt({ x: 0, y: 0, z: -6 });
  },
};
