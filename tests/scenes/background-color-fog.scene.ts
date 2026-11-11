import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SKY = 0x9db8cf;

export const scene: TestScene = {
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      toneMapping: 'none',
      background: SKY,
      fog: { type: 'exp2', color: SKY, density: 0.09 },
    });

    app.stage.addChild(view3d);

    const ground = new Mesh3D({
      geometry: new PlaneGeometry({ width: 200, height: 200 }),
      material: new Material3D({ baseColor: 0x6b8f4e, metallic: 0, roughness: 0.9 }),
      castShadow: false,
      receiveShadow: false,
    });
    ground.rotation.x = -Math.PI / 2;
    view3d.root.addChild(ground);

    const geometry = new CubeGeometry({ width: 1, height: 2, depth: 1 });
    const material = new Material3D({ baseColor: 0xc24d2c, metallic: 0, roughness: 0.6 });

    for (let i = 0; i < 10; i++) {
      for (const x of [-2, 2]) {
        const pillar = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
        pillar.position.set(x, 1, -i * 4);
        view3d.root.addChild(pillar);
      }
    }

    const light = new DirectionalLight({ color: 0xffffff, intensity: 3 });
    light.rotation.set(-0.65, 0.55, 0.25);
    view3d.root.addChild(light);

    view3d.camera.position.set(0, 1.6, 5);
    view3d.camera.lookAt({ x: 0, y: 1.2, z: -10 });
  },
};
