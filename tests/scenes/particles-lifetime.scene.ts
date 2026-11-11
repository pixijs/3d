import type { TestScene } from '@test-utils';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { particleLifetimeBit } from '~/scene/particles/bits/particleLifetimeBit';
import { ParticleContainer3D } from '~/scene/particles/ParticleContainer3D';
import { View3D } from '~/scene/View3D';

import { puffTexture } from './helpers/particleTextures';

export const scene: TestScene = {
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    app.stage.addChild(view3d);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 0, 8);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    const wall = new Mesh3D({
      geometry: new PlaneGeometry({ width: 14, height: 10 }),
      material: new FlatMaterial({ baseColor: 0xd8dce4 }),
    });

    wall.position.set(0, 0, -2);
    view3d.root.addChild(wall);

    const particles = new ParticleContainer3D({
      texture: puffTexture(),
      capacity: 6,
      extraBits: [particleLifetimeBit],
    });

    view3d.root.addChild(particles);
    particles.uniforms.uParticleTime = 5;

    const records: [number, number][] = [
      [0, 10],
      [0, 4],
      [3, 4],
      [7, 4],
      [4.5, 1],
      [0, 4.99],
    ];

    records.forEach(([aBirth, aLife], i) => {
      particles.setParticle(i, {
        aPosition: { x: (i - 2.5) * 1.1, y: 0, z: 0 },
        aParticleSizeRot: { x: 1.4, y: 0 },
        aParticleColor: 0xff5533,
        aBirth,
        aLife,
      });
    });

    particles.upload();
  },
};
