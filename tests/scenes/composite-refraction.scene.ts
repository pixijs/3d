import type { TestScene } from '@test-utils';
import { Texture } from 'pixi.js';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 264;

function gridTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = '#19e6ff';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 512; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(512, i);
    ctx.stroke();
  }
  return Texture.from(c);
}

function buildView(composite: boolean, grid: Texture): View3D {
  const view = new View3D({ width: SIZE, height: SIZE, anchor: 0.5, composite, toneMapping: 'none' });
  view.camera.fov = 40;
  view.camera.position.set(0, 0, 4);
  view.camera.lookAt({ x: 0, y: 0, z: 0 });
  view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 1 }));

  const backdrop = new Mesh3D({
    geometry: new PlaneGeometry({ width: 8, height: 8 }),
    material: new Material3D({ baseColor: 0x000000, emissive: { color: 0xffffff, texture: grid } }),
  });
  backdrop.position.set(0, 0, -1.5);
  view.root.addChild(backdrop);

  const glass = new Mesh3D({
    geometry: new CubeGeometry({ width: 1.7, height: 1.7, depth: 1.7 }),
    material: new Material3D({
      baseColor: 0xffffff,
      metallic: 0,
      roughness: 0.04,
      transmission: { factor: 1, thickness: 0.6 },
      ior: 1.5,
    }),
  });
  glass.rotation.set(-0.35, 0.6, 0);
  view.root.addChild(glass);
  return view;
}

export const scene: TestScene = {
  app: {
    width: 660,
    height: 340,
    backgroundColor: 0x242c36,
    useBackBuffer: true,
  },
  delay: 120,
  pixelMatchWebgpu: 3000,
  create: async (app) => {
    const grid = gridTexture();

    const direct = buildView(false, grid);
    direct.position.set(180, 170);

    const composite = buildView(true, grid);
    composite.position.set(480, 170);

    app.stage.addChild(direct, composite);
  },
};
