import type { TestScene } from '@test-utils';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { particleLifetimeBit } from '~/scene/particles/bits/particleLifetimeBit';
import { ParticleContainer3D } from '~/scene/particles/ParticleContainer3D';
import { View3D } from '~/scene/View3D';

import { puffTexture } from './helpers/particleTextures';

// A bare container plus the lifetime bit, with the system clock pinned at 5s.
// Six particles in a row, alternating alive and dead by their birth and life,
// so the capture is three puffs with a gap between each. Nothing on the CPU
// knows which is which: the shader decides from the birth record.
//
// This is the first scene where a shader reads an attribute an extra bit
// declared, so it is also the proof that the derived layout is wired through
// on both backends rather than stripped as unused.
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

    // [birth, life] → progress at t = 5
    const records: [number, number][] = [
      [0, 10], // 0.5   alive
      [0, 4], // 1.25  expired
      [3, 4], // 0.5   alive
      [7, 4], // -0.5  not yet born
      [4.5, 1], // 0.5   alive
      [0, 4.99], // 1.002 just expired
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
