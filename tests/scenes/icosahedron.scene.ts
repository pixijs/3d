import type { TestScene } from '@test-utils';

import { IcosahedronGeometry } from '~/geometry/IcosahedronGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: {
    backgroundColor: 0xf4f1ea,
  },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    app.stage.addChild(view3d);

    const icosahedron = new Mesh3D({
      geometry: new IcosahedronGeometry({ radius: 0.95, detail: 2 }),
      material: new Material3D({ baseColor: 0xb84a62, metallic: 0, roughness: 0.4 }),
      castShadow: false,
      receiveShadow: false,
    });

    icosahedron.rotation.set(-0.2, 0.35, 0);

    view3d.root.addChild(icosahedron);

    const light = new DirectionalLight({ color: 0xffffff, intensity: 8 });

    light.rotation.set(-0.65, 0.55, 0.25);
    view3d.root.addChild(light);

    view3d.camera.position.set(0, 0, 2.5);
  },
};
