import type { TestScene } from '@test-utils';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { particleLifetimeBit } from '~/scene/particles/bits/particleLifetimeBit';
import { particleMotionBit } from '~/scene/particles/bits/particleMotionBit';
import { ParticleContainer3D } from '~/scene/particles/ParticleContainer3D';
import { View3D } from '~/scene/View3D';

import { puffTexture } from './helpers/particleTextures';

export const scene: TestScene = {
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    app.stage.addChild(view3d);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 1, 9);
    view3d.camera.lookAt({ x: 0, y: 1, z: 0 });

    const wall = new Mesh3D({
      geometry: new PlaneGeometry({ width: 14, height: 10 }),
      material: new FlatMaterial({ baseColor: 0xafb7c6 }),
    });

    wall.position.set(0, 1, -2);
    view3d.root.addChild(wall);

    const texture = puffTexture();

    [0, 1.5].forEach((uDrag, side) => {
      const particles = new ParticleContainer3D({
        texture,
        capacity: 8,
        blendMode: 'add',
        extraBits: [particleLifetimeBit, particleMotionBit],
      });

      view3d.root.addChild(particles);
      particles.uniforms.uParticleTime = 2;
      particles.uniforms.uGravity = [0, -4, 0];
      particles.uniforms.uDrag = uDrag;

      const x0 = side === 0 ? -3.2 : 0.4;

      for (let i = 0; i < 8; i++) {
        particles.setParticle(i, {
          aPosition: { x: x0, y: -0.5, z: 0 },
          aParticleSizeRot: { x: 0.5, y: 0 },
          aParticleColor: side === 0 ? 0x33ccff : 0xffaa33,
          aVel: { x: 2.2, y: 4.5, z: 0 },
          aBirth: i * 0.25,
          aLife: 3,
        });
      }

      particles.upload();
    });
  },
};
