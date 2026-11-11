import type { TestScene } from '@test-utils';
import { Texture } from 'pixi.js';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { ParticleContainer3D } from '~/scene/particles/ParticleContainer3D';
import { Sprite3D } from '~/scene/Sprite3D';
import { View3D } from '~/scene/View3D';

const FOG_COLOR = 0x808080;
const SURFACE = 0xd0402a;
const SIZE = 0.4;
const CAMERA_Z = 3.5;
const COUNT = 9;

export const scene: TestScene = {
  app: {
    backgroundColor: FOG_COLOR,
  },
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      toneMapping: 'none',
      fog: { type: 'linear', color: FOG_COLOR, near: 3, far: 13 },
    });

    app.stage.addChild(view3d);

    view3d.camera.position.set(0, 0, CAMERA_Z);
    view3d.root.addChild(new DirectionalLight({ intensity: 3 }));

    const geometry = new PlaneGeometry({ width: SIZE, height: SIZE });
    const lit = new Material3D({ baseColor: SURFACE, metallic: 0, roughness: 0.8 });
    const flat = new FlatMaterial({ baseColor: SURFACE });
    const particles = new ParticleContainer3D({ capacity: COUNT, alphaMode: 'opaque' });

    for (let i = 0; i < COUNT; i++) {
      const z = -i * 1.5;
      const depth = CAMERA_Z - z;
      const x = (i / (COUNT - 1) - 0.5) * 0.9 * depth;
      const y = (row: number): number => (1.5 - row) * 0.26 * depth;
      const litMesh = new Mesh3D({ geometry, material: lit, castShadow: false });
      const flatMesh = new Mesh3D({ geometry, material: flat, castShadow: false });
      const sprite = new Sprite3D({ texture: Texture.WHITE, tint: SURFACE, pixelSize: SIZE });

      litMesh.position.set(x, y(0), z);
      flatMesh.position.set(x, y(1), z);
      sprite.position.set(x, y(2), z);
      particles.setParticleAt(i, x, y(3), z, SIZE, 0, SURFACE, 1);

      view3d.root.addChild(litMesh, flatMesh, sprite);
    }

    particles.upload();
    view3d.root.addChild(particles);
  },
};
