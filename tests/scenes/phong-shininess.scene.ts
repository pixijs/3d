import type { TestScene } from '@test-utils';

import { SphereGeometry } from '~/geometry/SphereGeometry';
import { PhongMaterial } from '~/materials/phong/PhongMaterial';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: {
    backgroundColor: 0x14141a,
  },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    app.stage.addChild(view3d);

    const geometry = new SphereGeometry({ radius: 0.7, widthSegments: 48, heightSegments: 24 });
    const shininess = [8, 48, 256];

    for (let i = 0; i < shininess.length; i++) {
      const sphere = new Mesh3D({
        geometry,
        material: new PhongMaterial({ baseColor: 0x8a8f98, specularColor: 0x888888, shininess: shininess[i] }),
        castShadow: false,
        receiveShadow: false,
      });
      sphere.position.set((i - 1) * 1.8, 0, 0);
      view3d.root.addChild(sphere);
    }

    const key = new DirectionalLight({ color: 0xffffff, intensity: 6 });
    key.rotation.set(-0.5, 0.4, 0.15);
    view3d.root.addChild(key);

    view3d.root.addChild(new AmbientLight({ color: 0x3a4050, intensity: 1 }));

    view3d.camera.position.set(0, 0, 5);
  },
};
