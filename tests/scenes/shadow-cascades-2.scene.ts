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
      geometry: new PlaneGeometry({ width: 30, height: 30 }),
      material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
      castShadow: false,
    });
    ground.position.set(0, -0.5, 0);
    ground.rotation.set(-Math.PI / 2, 0, 0);
    view3d.root.addChild(ground);

    const near = new Mesh3D({
      geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
      material: new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.5 }),
      castShadow: true,
    });
    near.position.set(1.2, 0, 0.5);
    view3d.root.addChild(near);

    const far = new Mesh3D({
      geometry: new CubeGeometry({ width: 1.4, height: 1.4, depth: 1.4 }),
      material: new Material3D({ baseColor: 0xc06c4a, metallic: 0, roughness: 0.5 }),
      castShadow: true,
    });
    far.position.set(-1, 0.2, -9);
    view3d.root.addChild(far);

    const sun = new DirectionalLight({
      color: 0xfff4e0,
      intensity: 5,
      castShadow: true,
      shadow: { cascades: 2, maxDistance: 25 },
    });
    sun.rotation.set((-50 * Math.PI) / 180, (30 * Math.PI) / 180, 0);
    view3d.root.addChild(sun);

    view3d.camera.fov = 50;
    view3d.camera.position.set(0, 4, 4);
    view3d.camera.lookAt({ x: 0, y: 0, z: -3 });
  },
};
