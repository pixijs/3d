import type { TestScene } from '@test-utils';
import { Texture } from 'pixi.js';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { Sprite3D } from '~/scene/Sprite3D';
import { View3D } from '~/scene/View3D';

// The two alpha paths a sprite can take.
//
// Left: three soft radial blobs at staggered depths, blended. They overlap, so
// the transparent pass has to sort them back-to-front — a wrong order changes
// which colour wins in the overlap. Tint and alpha vary per sprite, all sharing
// one texture and (because the material row carries both) one instanced draw.
//
// Right: the same disc as a 'mask' cutout in front of a bright bar. Blended, the
// disc's soft edge would fade the bar through; masked, the cutout is binary and
// the bar shows through only outside the alphaCutoff.

/** Radial white blob, fully transparent at the rim. */
function blobCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.85)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return canvas;
}

export const scene: TestScene = {
  create: async (app) => {
    const blob = Texture.from({ resource: blobCanvas(), alphaMode: 'premultiply-alpha-on-upload' });

    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 0, 6);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    // Bar behind the cutout, so the mask's binary edge is readable.
    const bar = new Mesh3D({
      geometry: new CubeGeometry({ width: 2.6, height: 0.35, depth: 0.1 }),
      material: new FlatMaterial({ baseColor: 0xffcc33 }),
    });
    bar.position.set(1.3, 0, -0.6);
    view3d.root.addChild(bar);

    // Blended stack — deliberately added front-to-back so the pass's own sort is
    // what puts them right.
    const blended: [number, number, number, number, number][] = [
      // x, y, z, tint, alpha
      [-1.25, 0.35, 0.6, 0x44ddff, 0.9],
      [-0.85, 0.0, 0.0, 0xff5599, 0.75],
      [-1.25, -0.35, -0.6, 0xffee66, 0.6],
    ];
    for (const [x, y, z, tint, alpha] of blended) {
      const sprite = new Sprite3D({ texture: blob, tint, alpha, pixelSize: 1 / 40 });
      sprite.position.set(x, y, z);
      view3d.root.addChild(sprite);
    }

    // Cutout: same disc, hard-edged, in front of the bar.
    const cutout = new Sprite3D({
      texture: blob,
      tint: 0x66ff99,
      alphaMode: 'mask',
      alphaCutoff: 0.6,
      pixelSize: 1 / 40,
    });
    cutout.position.set(1.3, 0, 0.4);
    view3d.root.addChild(cutout);
  },
};
