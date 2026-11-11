import type { TestScene } from '@test-utils';
import { Assets } from 'pixi.js';
import type { CubeTexture } from 'pixi.js';

import '~/assets/init';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import { environment } from '../../examples/assets/manifest';

const HDR = environment('hdri.VeniceSunset');

export const scene: TestScene = {
  assets: [HDR],
  app: { backgroundColor: 0x000000 },
  create: async (app) => {
    const sky = Assets.get<CubeTexture>(HDR);
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height, toneMapping: 'aces' });
    view3d.environment = sky;
    view3d.background = sky;
    app.stage.addChild(view3d);

    const geometry = new SphereGeometry({ radius: 0.45, widthSegments: 48, heightSegments: 32 });
    app.stage.once('destroyed', () => {
      view3d.environment = null;
      view3d.background = null;
      view3d.destroy({ children: true, material: true });
      geometry.destroy(true);
    });

    const roughnessSteps = [0, 0.25, 0.5, 0.75, 1];
    for (let i = 0; i < roughnessSteps.length; i++) {
      const mesh = new Mesh3D({
        geometry,
        material: new Material3D({ baseColor: 0xffffff, metallic: 1, roughness: roughnessSteps[i] }),
        castShadow: false,
        receiveShadow: false,
      });
      mesh.position.set(0, 0, (i - 2) * 1.05);
      view3d.root.addChild(mesh);
    }

    view3d.camera.position.set(4.2, 0, 0);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  },
};
