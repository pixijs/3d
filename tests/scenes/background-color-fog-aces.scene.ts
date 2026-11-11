import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const HAZE = 0x968c34;

export const scene: TestScene = {
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      toneMapping: 'aces',
      exposure: 1.8,
      background: HAZE,
      fog: { type: 'linear', color: HAZE, near: 4, far: 30 },
    });

    app.stage.addChild(view3d);

    const ground = new Mesh3D({
      geometry: new PlaneGeometry({ width: 400, height: 400 }),
      material: new Material3D({ baseColor: 0x3d5a80, metallic: 0, roughness: 0.9 }),
      castShadow: false,
      receiveShadow: false,
    });
    ground.rotation.x = -Math.PI / 2;
    view3d.root.addChild(ground);

    const geometry = new CubeGeometry({ width: 1.2, height: 3, depth: 1.2 });
    const material = new Material3D({ baseColor: 0xe0e0e0, metallic: 0, roughness: 0.5 });

    for (let i = 0; i < 12; i++) {
      const pillar = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
      pillar.position.set(i % 2 === 0 ? -3 : 3, 1.5, -i * 5);
      view3d.root.addChild(pillar);
    }

    const light = new DirectionalLight({ color: 0xffffff, intensity: 3 });
    light.rotation.set(-0.65, 0.55, 0.25);
    view3d.root.addChild(light);

    view3d.camera.position.set(0, 1.4, 5);
    view3d.camera.lookAt({ x: 0, y: 1, z: -20 });
  },
};
