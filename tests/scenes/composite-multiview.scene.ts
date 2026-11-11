import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 200;
const ACCENTS = [0xff4455, 0x44dd66, 0x4488ff];

function buildView(color: number, x: number): View3D {
  const view = new View3D({ width: SIZE, height: SIZE, anchor: 0.5, composite: true, toneMapping: 'none' });
  view.position.set(x, 170);

  view.camera.fov = 40;
  view.camera.position.set(0, 0, 4);
  view.camera.lookAt({ x: 0, y: 0, z: 0 });

  view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.6 }));
  const key = new DirectionalLight({ color: 0xffffff, intensity: 2.5 });
  key.position.set(3, 4, 5);
  key.lookAt({ x: 0, y: 0, z: 0 });
  view.root.addChild(key);

  const cube = new Mesh3D({
    geometry: new CubeGeometry({ width: 1.6, height: 1.6, depth: 1.6 }),
    material: new Material3D({ baseColor: color, metallic: 0, roughness: 0.5 }),
  });
  cube.rotation.set(-0.5, 0.7, 0);
  view.root.addChild(cube);

  return view;
}

export const scene: TestScene = {
  app: {
    width: 720,
    height: 340,
    backgroundColor: 0x242c36,
  },
  delay: 120,
  create: async (app) => {
    app.stage.addChild(buildView(ACCENTS[0], 130), buildView(ACCENTS[1], 360), buildView(ACCENTS[2], 590));
  },
};
