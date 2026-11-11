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
      geometry: new PlaneGeometry({ width: 40, height: 40 }),
      material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
      castShadow: false,
    });
    ground.position.set(0, -0.5, 0);
    ground.rotation.set(-Math.PI / 2, 0, 0);
    view3d.root.addChild(ground);

    const colors = [0x4a7c59, 0xc06c4a, 0x4a6cc0, 0xc0a84a];
    for (let i = 0; i < colors.length; i++) {
      const cube = new Mesh3D({
        geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
        material: new Material3D({ baseColor: colors[i], metallic: 0, roughness: 0.5 }),
        castShadow: true,
      });
      cube.position.set(-1.5, 0, -i * 4);
      view3d.root.addChild(cube);
    }

    const sun = new DirectionalLight({
      color: 0xfff4e0,
      intensity: 5,
      castShadow: true,
      shadow: { cascades: 3, maxDistance: 30 },
    });
    sun.rotation.set((-45 * Math.PI) / 180, (35 * Math.PI) / 180, 0);
    view3d.root.addChild(sun);

    view3d.camera.fov = 50;
    view3d.camera.position.set(5, 5, 8);
    view3d.camera.lookAt({ x: -1, y: 0, z: -4 });
  },
};
