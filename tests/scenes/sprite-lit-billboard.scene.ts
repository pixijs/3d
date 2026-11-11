import type { TestScene } from '@test-utils';
import { Texture } from 'pixi.js';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { Sprite3D } from '~/scene/Sprite3D';
import { View3D } from '~/scene/View3D';

function discCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

function domeNormalCanvas(): HTMLCanvasElement {
  const size = 64;
  const radius = 30;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5 - size / 2) / radius;
      const ny = (size / 2 - (y + 0.5)) / radius;
      const rSq = nx * nx + ny * ny;
      const inside = rSq < 1;
      const nz = inside ? Math.sqrt(1 - rSq) : 1;
      const i = (y * size + x) * 4;
      image.data[i] = Math.round(((inside ? nx : 0) * 0.5 + 0.5) * 255);
      image.data[i + 1] = Math.round(((inside ? ny : 0) * 0.5 + 0.5) * 255);
      image.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

const YAWS = [0, 0.7, 1.1];

export const scene: TestScene = {
  create: async (app) => {
    const disc = Texture.from(discCanvas());
    disc.source.scaleMode = 'nearest';

    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 0.2, 11);
    view3d.camera.lookAt({ x: 0, y: 0.2, z: 0 });

    view3d.root.addChild(new AmbientLight({ color: 0x2a3040, intensity: 1 }));

    const key = new DirectionalLight({ color: 0xffffff, intensity: 4 });
    key.position.set(0.5, 3, 8);
    key.lookAt({ x: 0, y: 0, z: 0 });
    view3d.root.addChild(key);

    const ground = new Mesh3D({
      geometry: new PlaneGeometry({ width: 14, height: 14 }),
      material: new FlatMaterial({ baseColor: 0x14181f }),
    });
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -3.1;
    view3d.root.addChild(ground);

    const litMaterial = () =>
      new Material3D({ baseColorTexture: disc, alphaMode: 'mask', baseColor: 0xd8d2c4, metallic: 0, roughness: 0.65 });

    YAWS.forEach((yaw, i) => {
      const billboarded = new Sprite3D({
        billboardMode: 'spherical',
        height: 1.7,
        material: litMaterial(),
      });
      billboarded.position.set((i - 1) * 2.3, 1.9, 0);
      billboarded.rotation.y = yaw;
      view3d.root.addChild(billboarded);

      const plain = new Sprite3D({
        billboardMode: 'none',
        height: 1.7,
        material: litMaterial(),
      });
      plain.position.set((i - 1) * 2.3, -1.9, 0);
      plain.rotation.y = yaw;
      view3d.root.addChild(plain);
    });

    const domed = new Material3D({
      baseColorTexture: disc,
      normalTexture: Texture.from({ resource: domeNormalCanvas(), label: 'sprite-dome-normal' }),
      metallic: 0,
      roughness: 0.35,
      alphaMode: 'mask',
    });

    YAWS.forEach((_, i) => {
      const impostor = new Sprite3D({ material: domed, billboardMode: 'spherical', height: 1.5 });
      impostor.position.set((i - 1) * 2.3, 0, 0);
      view3d.root.addChild(impostor);
    });
  },
};
