import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: {
    backgroundColor: 0x0d0f16,
  },
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      shadowQuality: 'low',
    });
    app.stage.addChild(view3d);

    const ground = new Mesh3D({
      geometry: new PlaneGeometry({ width: 4000, height: 4000 }),
      material: new Material3D({ baseColor: 0xcccccc, metallic: 0, roughness: 0.95 }),
      castShadow: false,
    });
    ground.rotation.set(-Math.PI / 2, 0, 0);
    view3d.root.addChild(ground);

    for (let row = 0; row < 24; row++) {
      for (let col = -4; col <= 4; col++) {
        const pole = new Mesh3D({
          geometry: new CubeGeometry({ width: 2, height: 26, depth: 2 }),
          material: new Material3D({ baseColor: 0x5b6884, metallic: 0, roughness: 0.7 }),
          castShadow: true,
        });
        pole.position.set(col * 52 + (row % 2) * 26, 13, -row * 36);
        view3d.root.addChild(pole);
      }
    }

    const sun = new DirectionalLight({
      color: 0xffffff,
      intensity: 4.5,
      castShadow: true,
      shadow: { cascades: 2, maxDistance: 760, lambda: 0 },
    });
    const elevation = (26 * Math.PI) / 180;
    const azimuth = (-70 * Math.PI) / 180;
    sun.position.set(
      Math.sin(azimuth) * Math.cos(elevation) * 300,
      Math.sin(elevation) * 300,
      Math.cos(azimuth) * Math.cos(elevation) * 300,
    );
    sun.lookAt({ x: 0, y: 0, z: -300 });
    view3d.root.addChild(sun);

    view3d.camera.fov = 50;
    view3d.camera.near = 1;
    view3d.camera.far = 3000;
    view3d.camera.position.set(0, 210, 150);
    view3d.camera.lookAt({ x: 0, y: 0, z: -260 });
  },
};
