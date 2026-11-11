import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import { solidTexture } from './helpers/solidTexture';

const RUN = 18;

export const scene: TestScene = {
  app: { backgroundColor: 0x101018 },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    view3d.camera.fov = 50;
    view3d.camera.position.set(0.5, 1, 18);

    const cube = new CubeGeometry({ width: 0.9, height: 0.9, depth: 0.9 });
    const sphere = new SphereGeometry({ radius: 0.5 });
    const red = new FlatMaterial({ baseColor: 0xe03030 });
    const green = new FlatMaterial({ baseColor: 0x30c040 });
    const textured = new FlatMaterial({ baseColorTexture: solidTexture('#ff8800') });

    const add = (geometry: CubeGeometry | SphereGeometry, material: FlatMaterial, x: number, y: number) => {
      const mesh = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
      mesh.position.set(x, y, 0);
      view3d.root.addChild(mesh);
      return mesh;
    };

    const top = [red, red, green, textured, green].map((material, i) => add(cube, material, i * 2 - 5, 3));
    add(sphere, green, 5, 3);

    const amber = solidTexture('#ffcc00');
    const run = Array.from({ length: RUN }, (_, i) => {
      const material = new FlatMaterial({ baseColorTexture: amber });
      add(cube, material, (i % 9) * 1.4 - 6, i < 9 ? 0 : -1);
      return material;
    });
    app.render();

    textured.textures.baseColor = solidTexture('#00ccff');
    add(cube, textured, 7, 3);

    run[0].alphaMode = 'blend';
    run[0].textures.baseColor = solidTexture('#00ff00');
    app.render();

    top[0].material = green;
    top[1].material = new FlatMaterial({ baseColor: 0xff00ff });
    top[4].geometry = sphere;
    add(cube, new FlatMaterial({ baseColor: 0xff4040, baseColorTexture: amber }), 7, 0);
  },
};
