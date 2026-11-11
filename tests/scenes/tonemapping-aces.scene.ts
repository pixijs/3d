import type { TestScene } from '@test-utils';

import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const COLORS = [0xff2d2d, 0xffd000, 0x29c24a, 0x2f6bff, 0xb84bd8];

export const scene: TestScene = {
  app: {
    backgroundColor: 0x14161c,
  },
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      toneMapping: 'aces',
    });

    app.stage.addChild(view3d);

    const geometry = new SphereGeometry({ radius: 0.4, widthSegments: 32, heightSegments: 16 });
    const spacing = 0.92;
    const start = -((COLORS.length - 1) * spacing) / 2;

    for (let i = 0; i < COLORS.length; i++) {
      const sphere = new Mesh3D({
        geometry,
        material: new Material3D({ baseColor: COLORS[i], metallic: 0, roughness: 0.35 }),
        castShadow: false,
        receiveShadow: false,
      });

      sphere.position.set(start + i * spacing, 0, 0);
      view3d.root.addChild(sphere);
    }

    view3d.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.5 }));

    const key = new DirectionalLight({ color: 0xffffff, intensity: 6 });
    key.rotation.set(-0.6, 0.5, 0.2);
    view3d.root.addChild(key);

    view3d.camera.position.set(0, 0, 3.4);
  },
};
