import type { TestScene } from '@test-utils';
import { Rectangle, Texture } from 'pixi.js';

import { Sprite3D } from '~/scene/Sprite3D';
import { View3D } from '~/scene/View3D';

function atlasCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  const cells: [string, string, string][] = [
    ['#ee3344', '#661722', '#ffe9a0'],
    ['#33dd55', '#125c26', '#ffe9a0'],
    ['#3366ee', '#122a80', '#ffe9a0'],
    ['#eedd33', '#6b6112', '#ffe9a0'],
  ];
  const origins = [
    [0, 0],
    [32, 0],
    [0, 32],
    [32, 32],
  ];

  cells.forEach(([top, bottom, corner], i) => {
    const [x, y] = origins[i];
    ctx.fillStyle = top;
    ctx.fillRect(x, y, 32, 16);
    ctx.fillStyle = bottom;
    ctx.fillRect(x, y + 16, 32, 16);
    ctx.fillStyle = corner;
    ctx.fillRect(x + 2, y + 2, 8, 8);
  });

  return canvas;
}

export const scene: TestScene = {
  create: async (app) => {
    const atlas = Texture.from(atlasCanvas());
    atlas.source.scaleMode = 'nearest';
    const source = atlas.source;
    const frame = (x: number, y: number, rotate = 0): Texture =>
      new Texture({ source, frame: new Rectangle(x, y, 32, 32), rotate });

    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 0, 4.2);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    const place = (texture: Texture, x: number, y: number): void => {
      const sprite = new Sprite3D({ texture, pixelSize: 1 / 32 });
      sprite.position.set(x, y, 0);
      view3d.root.addChild(sprite);
    };

    place(frame(0, 0), -0.6, 0.6);
    place(frame(32, 0), 0.6, 0.6);
    place(frame(0, 32, 2), -0.6, -0.6);
    place(frame(32, 32), 0.6, -0.6);
  },
};
