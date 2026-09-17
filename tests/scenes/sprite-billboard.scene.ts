import type { TestScene } from '@test-utils';
import { Texture } from 'pixi.js';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { Sprite3D } from '~/scene/Sprite3D';
import { View3D } from '~/scene/View3D';

// The three billboard modes side by side, seen from an elevated off-axis camera
// — the one angle that separates them. Spherical faces the lens square on,
// cylindrical keeps its feet on the ground so it reads foreshortened, and 'none'
// stays welded to world +Z and skews.
//
// The back row pins the two cases that would break silently: a feet-anchored
// cylindrical sprite whose bottom edge must sit exactly on the ground plane, and
// one under a rotated parent, which must spin around its tilted axis rather than
// world up. Unlit flats throughout, so nothing depends on lighting.

/**
 * A deliberately lopsided marker: bright top half, dark bottom half, and a
 * corner wedge in the image's top-left. Any flip or mirror in the quad's UVs or
 * winding shows up immediately.
 */
function markerCanvas(top: string, bottom: string, wedge: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = top;
  ctx.fillRect(0, 0, 64, 48);
  ctx.fillStyle = bottom;
  ctx.fillRect(0, 48, 64, 48);

  ctx.fillStyle = wedge;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(30, 0);
  ctx.lineTo(0, 30);
  ctx.closePath();
  ctx.fill();

  return canvas;
}

function marker(top: string, bottom: string, wedge: string): Texture {
  const texture = Texture.from(markerCanvas(top, bottom, wedge));
  texture.source.scaleMode = 'nearest';
  return texture;
}

/** Checkerboard for the ground, so the sprites' contact points are readable. */
function groundTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#5a6472' : '#3a424e';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'nearest';
  return texture;
}

export const scene: TestScene = {
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    view3d.camera.fov = 45;
    view3d.camera.position.set(5.4, 5.0, 5.4);
    view3d.camera.lookAt({ x: 0, y: 0.7, z: 0 });

    // Ground plane, so the feet-anchored sprite has something to stand on.
    const ground = new Mesh3D({
      geometry: new PlaneGeometry({ width: 7, height: 7 }),
      material: new FlatMaterial({ baseColorTexture: groundTexture() }),
    });
    ground.rotation.x = -Math.PI / 2;
    view3d.root.addChild(ground);

    // Solid depth reference between the two rows.
    const cube = new Mesh3D({
      geometry: new CubeGeometry({ width: 0.7, height: 0.7, depth: 0.7 }),
      material: new FlatMaterial({ baseColor: 0xe8e2d0 }),
    });
    cube.position.set(0, 0.35, -1.8);
    view3d.root.addChild(cube);

    // 64x96 px at 64 ppu → 1 x 1.5 world units.
    const place = (sprite: Sprite3D, x: number, y: number, z: number): Sprite3D => {
      sprite.position.set(x, y, z);
      view3d.root.addChild(sprite);
      return sprite;
    };

    place(
      new Sprite3D({
        texture: marker('#ff5566', '#7a1a28', '#ffe066'),
        billboardMode: 'spherical',
        pixelSize: 1 / 64,
      }),
      -2.1,
      0.95,
      1.2,
    );

    place(
      new Sprite3D({
        texture: marker('#55dd77', '#175c2c', '#ffe066'),
        billboardMode: 'cylindrical',
        pixelSize: 1 / 64,
      }),
      0,
      0.95,
      1.2,
    );

    place(
      new Sprite3D({
        texture: marker('#5599ff', '#1a3a80', '#ffe066'),
        billboardMode: 'none',
        pixelSize: 1 / 64,
      }),
      2.1,
      0.95,
      1.2,
    );

    // Feet on the ground: anchor.y = 1 puts the image's bottom edge on the
    // node's origin, and cylindrical keeps it there from any camera angle.
    // 'mask' routes it through the opaque pass — the foliage path.
    place(
      new Sprite3D({
        texture: marker('#ffbb44', '#8a5a10', '#ffffff'),
        billboardMode: 'cylindrical',
        anchor: { x: 0.5, y: 1 },
        alphaMode: 'mask',
        pixelSize: 1 / 64,
      }),
      -2.1,
      0,
      -1.8,
    );

    // Tilted parent: the spin axis follows the node's own up column, so this one
    // leans while still turning toward the camera.
    const tilted = new Container3D();
    tilted.position.set(2.1, 0, -1.8);
    tilted.rotation.z = Math.PI / 7;
    view3d.root.addChild(tilted);

    const leaning = new Sprite3D({
      texture: marker('#cc66ff', '#4a1a70', '#ffffff'),
      billboardMode: 'cylindrical',
      anchor: { x: 0.5, y: 1 },
      alphaMode: 'mask',
      pixelSize: 1 / 64,
    });
    tilted.addChild(leaning);
  },
};
