import type { TestScene } from '@test-utils';
import { BlurFilter, Graphics } from 'pixi.js';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: {
    backgroundColor: 0x10131c,
    antialias: true,
  },
  delay: 250,
  create: async (app) => {
    const w = app.screen.width;
    const h = app.screen.height;

    const backdrop = new Graphics();
    const step = 24;
    for (let x = 0; x <= w; x += step) backdrop.moveTo(x, 0).lineTo(x, h);
    for (let y = 0; y <= h; y += step) backdrop.moveTo(0, y).lineTo(w, y);
    backdrop.stroke({ color: 0x2e6c8c, width: 2, alpha: 1 });
    app.stage.addChild(backdrop);

    const view3d = new View3D({ width: 300, height: 300, anchor: 0.5 });
    view3d.position.set(w / 2, h / 2);
    view3d.filters = [new BlurFilter({ strength: 8, quality: 4 })];
    app.stage.addChild(view3d);

    view3d.camera.fov = 35;
    view3d.camera.position.set(2.2, 1.8, 3.2);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    view3d.root.addChild(new AmbientLight({ color: 0xc8d8ff, intensity: 0.35 }));
    const keyLight = new DirectionalLight({ color: 0xfff4e0, intensity: 4 });
    keyLight.position.set(4, 5, 6);
    keyLight.lookAt({ x: 0, y: 0, z: 0 });
    view3d.root.addChild(keyLight);

    const cube = new Mesh3D({
      geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
      material: new Material3D({ baseColor: 0xff7733, metallic: 0.1, roughness: 0.4 }),
      castShadow: false,
      receiveShadow: false,
    });
    cube.rotation.set(-0.5, 0.7, 0.0);
    view3d.root.addChild(cube);

    let frames = 0;
    const onTick = () => {
      if (++frames >= 3) {
        view3d.filters = null;
        app.ticker.remove(onTick);
      }
    };
    app.ticker.add(onTick);
  },
};
