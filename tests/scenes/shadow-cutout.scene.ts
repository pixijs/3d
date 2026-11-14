import type { TestScene } from '@test-utils';
import { Texture } from 'pixi.js';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

function holedTexture(): Texture {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;

  const context = canvas.getContext('2d')!;
  context.fillStyle = '#e8a33d';
  context.fillRect(0, 0, size, size);
  context.globalCompositeOperation = 'destination-out';
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      context.beginPath();
      context.arc(16 + x * 32, 16 + y * 32, 10, 0, Math.PI * 2);
      context.fill();
    }
  }

  return Texture.from({ resource: canvas, alphaMode: 'premultiply-alpha-on-upload' });
}

export const scene: TestScene = {
  app: {
    width: 340,
    height: 260,
    backgroundColor: 0xe8eef4,
  },
  delay: 120,
  create: async (app) => {
    const view = new View3D({
      width: 320,
      height: 240,
      anchor: 0.5,
      toneMapping: 'none',
      shadowQuality: 'high',
      environment: { skyColor: 0x9fb2c4, groundColor: 0x445566 },
    });
    view.camera.fov = 40;
    view.camera.position.set(0, 5.5, 7);
    view.camera.lookAt({ x: 0, y: 0.6, z: 0 });

    view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.3 }));
    const sun = new DirectionalLight({ color: 0xffffff, intensity: 1.6, castShadow: true });
    sun.position.set(-1.5, 6, -5);
    sun.lookAt({ x: 0, y: 0, z: 0 });
    view.root.addChild(sun);

    const floor = new Mesh3D({
      geometry: new PlaneGeometry({ width: 12, height: 12 }),
      material: new Material3D({ baseColor: 0x8f9aa6, metallic: 0, roughness: 0.95 }),
      castShadow: false,
      receiveShadow: true,
    });
    floor.rotation.set(-Math.PI / 2, 0, 0);
    view.root.addChild(floor);

    const card = new Mesh3D({
      geometry: new PlaneGeometry({ width: 2.4, height: 2.4 }),
      material: new Material3D({
        baseColorTexture: holedTexture(),
        alphaMode: 'mask',
        alphaCutoff: 0.5,
        doubleSided: true,
        metallic: 0,
        roughness: 0.8,
      }),
      castShadow: true,
    });
    card.position.set(-1.5, 1.3, -0.6);
    card.rotation.set(0, Math.PI - 0.25, 0);
    view.root.addChild(card);

    const cube = new Mesh3D({
      geometry: new CubeGeometry({ width: 1.2, height: 1.2, depth: 1.2 }),
      material: new Material3D({ baseColor: 0x4488ff, metallic: 0, roughness: 0.6 }),
      castShadow: true,
    });
    cube.position.set(1.8, 0.6, -0.6);
    view.root.addChild(cube);

    view.position.set(170, 130);
    app.stage.addChild(view);
  },
};
