import type { TestScene } from '@test-utils';

import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { PhongMaterial } from '~/materials/phong/PhongMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: {
    backgroundColor: 0x202020,
  },
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      toneMapping: 'none',
      environment: { skyColor: 0x2288ff, groundColor: 0xaa3300, intensity: Math.PI },
    });

    app.stage.addChild(view3d);

    const geometry = new SphereGeometry({ radius: 0.85, widthSegments: 32, heightSegments: 16 });

    const phong = new Mesh3D({
      geometry,
      material: new PhongMaterial({ baseColor: 0xffffff }),
      castShadow: false,
      receiveShadow: false,
    });
    phong.position.set(-1, 0, 0);
    view3d.root.addChild(phong);

    const pbr = new Mesh3D({
      geometry,
      material: new Material3D({ baseColor: 0xffffff, metallic: 0, roughness: 1 }),
      castShadow: false,
      receiveShadow: false,
    });
    pbr.position.set(1, 0, 0);
    view3d.root.addChild(pbr);

    view3d.camera.position.set(0, 0, 4);
  },
};
