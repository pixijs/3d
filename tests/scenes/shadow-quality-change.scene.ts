import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: {
    backgroundColor: 0x11141c,
  },
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      shadowQuality: 'low',
    });
    app.stage.addChild(view3d);

    const ground = new Mesh3D({
      geometry: new PlaneGeometry({ width: 60, height: 60 }),
      material: new Material3D({ baseColor: 0xbbbbbb, metallic: 0, roughness: 0.9 }),
      castShadow: false,
    });
    ground.rotation.set(-Math.PI / 2, 0, 0);
    view3d.root.addChild(ground);

    const colors = [0x4a7c59, 0xc06c4a, 0x4a6cc0];
    for (let i = 0; i < colors.length; i++) {
      const cube = new Mesh3D({
        geometry: new CubeGeometry({ width: 3, height: 6, depth: 3 }),
        material: new Material3D({ baseColor: colors[i], metallic: 0, roughness: 0.6 }),
        castShadow: true,
      });
      cube.position.set(-8 + i * 8, 3, i * 2 - 2);
      view3d.root.addChild(cube);
    }

    const sun = new DirectionalLight({
      color: 0xfff4e0,
      intensity: 5,
      castShadow: true,
      shadow: { cascades: 3, maxDistance: 90 },
    });
    const elevation = (40 * Math.PI) / 180;
    const azimuth = (-50 * Math.PI) / 180;
    sun.position.set(
      Math.sin(azimuth) * Math.cos(elevation) * 100,
      Math.sin(elevation) * 100,
      Math.cos(azimuth) * Math.cos(elevation) * 100,
    );
    sun.lookAt({ x: 0, y: 0, z: 0 });
    view3d.root.addChild(sun);

    view3d.camera.fov = 45;
    view3d.camera.position.set(14, 18, 26);
    view3d.camera.lookAt({ x: 0, y: 2, z: 0 });

    for (let i = 0; i < 4; i++) {
      app.render();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }

    view3d.shadowQuality = 'high';

    for (let i = 0; i < 4; i++) {
      app.render();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
  },
};
