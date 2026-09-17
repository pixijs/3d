import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Container3D } from '~/scene/Container3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

// Regression: hidden shadow-casting mesh must not crash the pipe on the first frame.
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
      geometry: new PlaneGeometry({ width: 8, height: 8 }),
      material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
    });
    ground.position.set(0, -0.5, 0);
    ground.rotation.set(-Math.PI / 2, 0, 0);
    view3d.root.addChild(ground);

    const visibleCube = new Mesh3D({
      geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
      material: new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.4 }),
      castShadow: true,
    });
    visibleCube.position.set(0, 0, 0);
    view3d.root.addChild(visibleCube);

    // Hidden shadow caster wrapped so `worldVisible` cascades from the parent.
    const hiddenWrap = new Container3D();
    hiddenWrap.visible = false;
    view3d.root.addChild(hiddenWrap);

    const hiddenCube = new Mesh3D({
      geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 }),
      material: new Material3D({ baseColor: 0xff2222, metallic: 0, roughness: 0.3 }),
      castShadow: true,
    });
    hiddenWrap.addChild(hiddenCube);

    const sun = new DirectionalLight({ color: 0xfff4e0, intensity: 6, castShadow: true });
    sun.rotation.set((-40 * Math.PI) / 180, (30 * Math.PI) / 180, 0);
    view3d.root.addChild(sun);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 2, 4);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  },
};
