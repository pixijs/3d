import type { TestScene } from '@test-utils';
import { Graphics } from 'pixi.js';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: { width: 600, height: 600, backgroundColor: 0x10202a, useBackBuffer: true },
  delay: 250,
  create: async (app) => {
    const backdrop = new Graphics();
    backdrop.rect(0, 0, 300, 600).fill(0xff5566);
    backdrop.rect(300, 0, 300, 600).fill(0x3a7ca5);
    for (let x = 0; x <= 600; x += 24) backdrop.moveTo(x, 0).lineTo(x, 600);
    for (let y = 0; y <= 600; y += 24) backdrop.moveTo(0, y).lineTo(600, y);
    backdrop.stroke({ color: 0xffffff, width: 2, alpha: 0.8 });
    app.stage.addChild(backdrop);

    const view3d = new View3D({ width: 200, height: 200, anchor: 0.5 });
    view3d.position.set(300, 300);
    app.stage.addChild(view3d);

    view3d.camera.fov = 35;
    view3d.camera.position.set(2.2, 1.8, 3.2);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    view3d.root.addChild(new AmbientLight({ color: 0xc8d8ff, intensity: 0.4 }));
    const key = new DirectionalLight({ color: 0xfff4e0, intensity: 3 });
    key.position.set(4, 5, 6);
    key.lookAt({ x: 0, y: 0, z: 0 });
    view3d.root.addChild(key);

    const cube = new Mesh3D({
      geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
      material: new Material3D({
        baseColor: 0xffffff,
        metallic: 0,
        roughness: 0.05,
        transmission: { factor: 1, thickness: 0.5 },
        ior: 1.5,
      }),
      castShadow: false,
      receiveShadow: false,
    });
    cube.rotation.set(-0.5, 0.7, 0.0);
    view3d.root.addChild(cube);

    let frame = 0;
    app.ticker.add(() => {
      frame++;
      if (frame === 3) {
        view3d.setSize(300, 300);
        backdrop.x = -150;
      }
    });
  },
};
