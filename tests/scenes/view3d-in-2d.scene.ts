import type { TestScene } from '@test-utils';
import { Container, Graphics } from 'pixi.js';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: {
    backgroundColor: 0x10202a,
  },
  delay: 120,
  create: async (app) => {
    const w = app.screen.width;
    const h = app.screen.height;

    const backdrop = new Graphics();
    const step = 24;
    for (let x = 0; x <= w; x += step) backdrop.moveTo(x, 0).lineTo(x, h);
    for (let y = 0; y <= h; y += step) backdrop.moveTo(0, y).lineTo(w, y);
    backdrop.stroke({ color: 0x2e6c8c, width: 2, alpha: 1 });
    app.stage.addChild(backdrop);

    const makeCard = (x: number, y: number, color: number, rot: [number, number, number]): Container => {
      const card = new Container();
      card.position.set(x, y);

      const view3d = new View3D({ width: 150, height: 150, anchor: 0.5 });
      card.addChild(view3d);

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
        material: new Material3D({ baseColor: color, metallic: 0.1, roughness: 0.45 }),
        castShadow: false,
        receiveShadow: false,
      });
      cube.rotation.set(rot[0], rot[1], rot[2]);
      view3d.root.addChild(cube);

      app.stage.addChild(card);
      return card;
    };

    makeCard(w * 0.42, h * 0.42, 0xff5566, [-0.5, 0.7, 0.0]);
    makeCard(w * 0.6, h * 0.6, 0x66ccff, [0.3, -0.6, 0.1]);
  },
};
