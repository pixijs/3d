import type { TestScene } from '@test-utils';
import { Texture } from 'pixi.js';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

function createCutoutCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgb(180, 95, 42)';
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.5, size * 0.42, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

export const scene: TestScene = {
  app: {
    backgroundColor: 0xe6edf5,
  },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    const albedo = Texture.from({
      resource: createCutoutCanvas(64),
      label: 'alpha-mask-edge-albedo',
      alphaMode: 'premultiply-alpha-on-upload',
    });

    const mesh = new Mesh3D({
      geometry: new PlaneGeometry({ width: 2.4, height: 2.4 }),
      material: new Material3D({
        baseColor: 'white',
        baseColorTexture: albedo,
        alphaMode: 'mask',
        alphaCutoff: 0.5,
        metallic: 0,
        roughness: 0.6,
        doubleSided: true,
      }),
      castShadow: false,
      receiveShadow: false,
    });
    view3d.root.addChild(mesh);

    const light = new DirectionalLight({ color: 0xffffff, intensity: 6 });
    light.rotation.set(-0.3, 0.15, 0);
    view3d.root.addChild(light);

    view3d.camera.position.set(0, 0, 2.5);
  },
};
