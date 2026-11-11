import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: {
    backgroundColor: 0x1a1a2e,
  },
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      shadowQuality: 'medium',
    });
    app.stage.addChild(view3d);

    const ground = new Mesh3D({
      geometry: new PlaneGeometry({ width: 4000, height: 4000 }),
      material: new Material3D({ baseColor: 0x909090, metallic: 0, roughness: 0.9 }),
      castShadow: false,
    });
    ground.rotation.set(-Math.PI / 2, 0, 0);
    view3d.root.addChild(ground);

    const colors = [0x4a7c59, 0xc06c4a, 0x4a6cc0, 0xc0a84a, 0x8a5cc0];
    for (let i = 0; i < 5; i++) {
      const d = 120 + i * 190;
      const pillar = new Mesh3D({
        geometry: new CubeGeometry({ width: 14, height: 42, depth: 14 }),
        material: new Material3D({ baseColor: colors[i], metallic: 0, roughness: 0.6 }),
        castShadow: true,
      });
      pillar.position.set(-d * 0.1, 21, -d);
      view3d.root.addChild(pillar);
    }

    const sun = new DirectionalLight({
      color: 0xfff4e0,
      intensity: 5,
      castShadow: true,
      shadow: { cascades: 4, maxDistance: 1400 },
    });
    sun.rotation.set((-38 * Math.PI) / 180, (-55 * Math.PI) / 180, 0);
    view3d.root.addChild(sun);

    view3d.camera.fov = 40;
    view3d.camera.near = 1;
    view3d.camera.far = 4000;
    view3d.camera.position.set(0, 150, 190);
    view3d.camera.lookAt({ x: -50, y: 0, z: -500 });
  },
};
