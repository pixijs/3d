import type { TestScene } from '@test-utils';
import { Rectangle, Texture } from 'pixi.js';

import { Sprite3D } from '~/scene/Sprite3D';
import { View3D } from '~/scene/View3D';

// Four sprites cut from one 2x2 canvas atlas. Every quadrant is asymmetric in
// both axes — bright top half, dark bottom half, corner block on the left — so
// the flipped-V sprite quad has to land each frame upright and unmirrored, and a
// whole-atlas sample (a missed UV frame) is unmistakable.
//
// The bottom-left sprite takes a GroupD8-rotated frame: its split turns from
// horizontal to vertical, which is only possible if the rotation survives frame
// derivation. One shared source means one bind group and one instanced draw.
//
// Camera sits square on +Z, so the default spherical mode resolves to a
// screen-aligned quad and the expected image is exactly the atlas cell.

function atlasCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  // [top, bottom, corner] per quadrant: TL red, TR green, BL blue, BR yellow.
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

    // 32 px frames at 32 ppu → 1 world unit square.
    const place = (texture: Texture, x: number, y: number): void => {
      const sprite = new Sprite3D({ texture, pixelSize: 1 / 32 });
      sprite.position.set(x, y, 0);
      view3d.root.addChild(sprite);
    };

    place(frame(0, 0), -0.6, 0.6); // red
    place(frame(32, 0), 0.6, 0.6); // green
    place(frame(0, 32, 2), -0.6, -0.6); // blue, rotated 90°
    place(frame(32, 32), 0.6, -0.6); // yellow
  },
};
