import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: { backgroundColor: 0x1a1a2e },
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      shadowQuality: 'medium',
      cull: 'gpu',
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

    const colors = [0x4a7c59, 0xc06c4a, 0x4a6cc0];
    const cubes: Mesh3D[] = [];
    for (let i = 0; i < colors.length; i++) {
      const cube = new Mesh3D({
        geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
        material: new Material3D({ baseColor: colors[i], metallic: 0, roughness: 0.5 }),
        castShadow: true,
      });
      cube.position.set((i - 1) * 3, 0, 0);
      view3d.root.addChild(cube);
      cubes.push(cube);
    }

    const sun1 = new DirectionalLight({
      color: 0xfff4e0,
      intensity: 4,
      castShadow: true,
      shadow: { cascades: 2, maxDistance: 30 },
    });
    sun1.rotation.set((-50 * Math.PI) / 180, (30 * Math.PI) / 180, 0);
    view3d.root.addChild(sun1);

    const sun2 = new DirectionalLight({
      color: 0xd0e4ff,
      intensity: 2.5,
      castShadow: true,
      shadow: { cascades: 2, maxDistance: 30 },
    });
    sun2.rotation.set((-55 * Math.PI) / 180, (-40 * Math.PI) / 180, 0);
    view3d.root.addChild(sun2);

    view3d.camera.fov = 50;
    view3d.camera.position.set(0, 6, 10);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    app.render();
    cubes[1].visible = false;
  },
};
