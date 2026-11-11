import type { TestScene } from '@test-utils';
import { ColorMatrixFilter, Container, Graphics } from 'pixi.js';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

function addCard(parent: Container, cx: number, cy: number, accent: number, scale: number): void {
  const card = new Container();
  card.position.set(cx, cy);
  card.scale.set(scale);
  parent.addChild(card);

  const frame = new Graphics().roundRect(-50, -50, 100, 100, 10).stroke({ color: accent, width: 4, alpha: 1 });
  card.addChild(frame);

  const view3d = new View3D({ width: 90, height: 90, anchor: 0.5 });
  card.addChild(view3d);

  view3d.camera.fov = 35;
  view3d.camera.position.set(2.2, 1.8, 3.2);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  view3d.root.addChild(new AmbientLight({ color: 0xc8d8ff, intensity: 0.4 }));
  const keyLight = new DirectionalLight({ color: 0xfff4e0, intensity: 3 });
  keyLight.position.set(4, 5, 6);
  keyLight.lookAt({ x: 0, y: 0, z: 0 });
  view3d.root.addChild(keyLight);

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
}

export const scene: TestScene = {
  app: {
    width: 500,
    height: 220,
    backgroundColor: 0x10202a,
    useBackBuffer: true,
  },
  delay: 120,
  create: async (app) => {
    const w = app.screen.width;
    const h = app.screen.height;

    const backdrop = new Graphics();
    const step = 16;
    for (let x = 0; x <= w; x += step) backdrop.moveTo(x, 0).lineTo(x, h);
    for (let y = 0; y <= h; y += step) backdrop.moveTo(0, y).lineTo(w, y);
    backdrop.stroke({ color: 0x3a7ca5, width: 1.5, alpha: 1 });
    app.stage.addChild(backdrop);

    app.stage.filters = [new ColorMatrixFilter()];
    (app.stage.filters[0] as ColorMatrixFilter).desaturate();

    const accents = [0xffc857, 0x88ffcc, 0xff5566, 0xa8c8ff, 0xffaaff];
    const scales = [0.6, 1.3, 0.8, 1.4, 1.0];
    for (let i = 0; i < 5; i++) {
      addCard(app.stage, ((i + 1) * w) / 6, h * 0.5, accents[i], scales[i]);
    }
  },
};
