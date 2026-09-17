import type { TestScene } from '@test-utils';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { particleAlphaOverLifeBit } from '~/scene/particles/bits/particleAlphaOverLifeBit';
import { particleColorOverLifeBit } from '~/scene/particles/bits/particleColorOverLifeBit';
import { particleLifetimeBit } from '~/scene/particles/bits/particleLifetimeBit';
import { particleSizeOverLifeBit } from '~/scene/particles/bits/particleSizeOverLifeBit';
import { ParticleContainer3D } from '~/scene/particles/ParticleContainer3D';
import { View3D } from '~/scene/View3D';

import { puffTexture } from './helpers/particleTextures';

// One row, every over-life ramp on at once. Eight particles share a lifetime
// and are born at staggered times, so left to right is progress 0 to 1: the
// puff shrinks, fades and shifts from hot orange to cool blue, and the last
// one is only just alive. The system clock is pinned, so the whole ramp is one
// deterministic capture.
export const scene: TestScene = {
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    app.stage.addChild(view3d);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 0, 8);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    const wall = new Mesh3D({
      geometry: new PlaneGeometry({ width: 14, height: 10 }),
      material: new FlatMaterial({ baseColor: 0x2a2f3a }),
    });

    wall.position.set(0, 0, -2);
    view3d.root.addChild(wall);

    const particles = new ParticleContainer3D({
      texture: puffTexture(),
      capacity: 8,
      blendMode: 'add',
      extraBits: [particleLifetimeBit, particleSizeOverLifeBit, particleAlphaOverLifeBit, particleColorOverLifeBit],
    });

    view3d.root.addChild(particles);
    particles.uniforms.uParticleTime = 4;

    for (let i = 0; i < 8; i++) {
      // Progress i/7 at t = 4 with a 4s life: born at 4 - 4·(i/7).
      particles.setParticle(i, {
        aPosition: { x: (i - 3.5) * 0.8, y: 0, z: 0 },
        aParticleSizeRot: { x: 1.3, y: 0 },
        aParticleColor: 0xff7722,
        aBirth: 4 - 4 * (i / 7) - 0.001,
        aLife: 4,
        aSizeEnd: 0.35,
        aAlphaEnd: 0.15,
        // Linear RGB, the same encoding as the decoded spawn tint.
        aColorEnd: { x: 0.05, y: 0.25, z: 1, w: 1 },
      });
    }

    particles.upload();
  },
};
