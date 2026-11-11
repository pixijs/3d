import type { TestScene } from '@test-utils';
import type { Application, ColorSource } from 'pixi.js';
import { Graphics } from 'pixi.js';

import { ContainerTexture } from '~/core/textures/ContainerTexture';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { Sprite3D } from '~/scene/Sprite3D';
import { View3D } from '~/scene/View3D';

function ringTexture(app: Application, clearColor?: ColorSource): ContainerTexture {
  const ring = new Graphics().circle(32, 32, 26).stroke({ color: 0x44ddff, width: 8 }).circle(32, 32, 9).fill(0xff5599);

  return new ContainerTexture({
    container: ring,
    width: 64,
    height: 64,
    resolution: 2,
    renderer: app.renderer,
    clearColor,
  });
}

export const scene: TestScene = {
  app: { backgroundColor: 0xf4f1ea },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    app.stage.addChild(view3d);
    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 0, 6);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    for (const [x, color] of [
      [-1.6, 0xffcc33],
      [-0.6, 0x33aa66],
      [0.6, 0xffcc33],
      [1.6, 0x33aa66],
    ] as const) {
      view3d.root.addChild(
        new Mesh3D({
          geometry: new CubeGeometry({ width: 0.5, height: 5, depth: 0.1 }),
          material: new FlatMaterial({ baseColor: color }),
          position: { x, y: 0, z: -1 },
        }),
      );
    }

    const columns = [
      { x: -1.1, texture: ringTexture(app, 'black') },
      { x: 1.1, texture: ringTexture(app) },
    ];

    for (const { x, texture } of columns) {
      view3d.root.addChild(
        new Sprite3D({ texture, pixelSize: 1 / 40, position: { x, y: 1.05, z: 0 } }),
        new Sprite3D({ texture, alphaMode: 'mask', pixelSize: 1 / 40, position: { x, y: -1.05, z: 0 } }),
      );
    }
  },
};
