import type { TestScene } from '@test-utils';
import { Matrix, Rectangle, Texture } from 'pixi.js';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

// Framed (spritesheet) baseColor textures drive the material UV transform.
// A 2×2 atlas of split-shade quadrants renders onto four quads:
//  - top-left / top-right: plain frames — each quad shows exactly its
//    quadrant (whole-atlas sampling would show all four colours per quad);
//  - bottom-left: a GroupD8-rotated frame — the bright/dark split flips from
//    vertical to horizontal, proving the rotation is encoded;
//  - bottom-right: a framed texture UNDER an explicit identity uvTransform —
//    explicit wins, so the whole atlas renders despite the frame.
// Unlit flats + nearest sampling keep the pixels deterministic.

function atlasCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  // [bright, dark] per quadrant: TL red, TR green, BL blue, BR yellow.
  const cells: [string, string][] = [
    ['#ee3344', '#881122'],
    ['#33dd44', '#117722'],
    ['#3366ee', '#112288'],
    ['#eedd33', '#887711'],
  ];
  const origins = [
    [0, 0],
    [32, 0],
    [0, 32],
    [32, 32],
  ];
  cells.forEach(([bright, dark], i) => {
    const [x, y] = origins[i];
    ctx.fillStyle = bright;
    ctx.fillRect(x, y, 16, 32);
    ctx.fillStyle = dark;
    ctx.fillRect(x + 16, y, 16, 32);
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
    view3d.camera.position.set(0, 0, 4.6);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    const geometry = new CubeGeometry({ width: 1.5, height: 1.5, depth: 0.1 });
    const place = (material: FlatMaterial, x: number, y: number): void => {
      const mesh = new Mesh3D({ geometry, material });
      mesh.position.set(x, y, 0);
      view3d.root.addChild(mesh);
    };

    place(new FlatMaterial({ baseColorTexture: frame(0, 0) }), -0.95, 0.95); // red quadrant
    place(new FlatMaterial({ baseColorTexture: frame(32, 0) }), 0.95, 0.95); // green quadrant
    place(new FlatMaterial({ baseColorTexture: frame(0, 32, 2) }), -0.95, -0.95); // blue, rotated 90°
    place(new FlatMaterial({ baseColorTexture: frame(32, 32), uvTransform: new Matrix() }), 0.95, -0.95); // explicit wins → whole atlas
  },
};
