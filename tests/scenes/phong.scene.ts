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

    const sphere = new Mesh3D({
      geometry: new SphereGeometry({ radius: 0.95, widthSegments: 48, heightSegments: 24 }),
      material: new PhongMaterial({ baseColor: 0x1f6f8b, specularColor: 0x666666, shininess: 48 }),
      castShadow: false,
      receiveShadow: false,
    });

    view3d.root.addChild(sphere);

    const key = new DirectionalLight({ color: 0xffffff, intensity: 6 });
    key.rotation.set(-0.6, 0.5, 0.2);
    view3d.root.addChild(key);

    view3d.root.addChild(new AmbientLight({ color: 0x404860, intensity: 1 }));

    view3d.camera.position.set(0, 0, 2.5);
  },
};
