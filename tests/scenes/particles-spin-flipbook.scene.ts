import type { TestScene } from '@test-utils';
import { Texture } from 'pixi.js';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { particleFlipbookOverLifeBit } from '~/scene/particles/bits/particleFlipbookBits';
import { particleLifetimeBit } from '~/scene/particles/bits/particleLifetimeBit';
import { particleSpinBit } from '~/scene/particles/bits/particleSpinBit';
import { ParticleContainer3D } from '~/scene/particles/ParticleContainer3D';
import { View3D } from '~/scene/View3D';

import { ringSheetTexture, wedgeTexture } from './helpers/particleTextures';

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

    const spinning = new ParticleContainer3D({
      texture: wedgeTexture(),
      capacity: 6,
      extraBits: [particleLifetimeBit, particleSpinBit],
    });

    view3d.root.addChild(spinning);
    spinning.uniforms.uParticleTime = 3;

    for (let i = 0; i < 6; i++) {
      spinning.setParticle(i, {
        aPosition: { x: (i - 2.5) * 1.1, y: 1.3, z: 0 },
        aParticleSizeRot: { x: 0.9, y: 0 },
        aParticleColor: 0x3355ff,
        aBirth: 3 - 3 * (i / 5) - 0.001,
        aLife: 10,
        aSpin: (Math.PI * 2) / 3,
      });
    }

    spinning.upload();

    const frames = ringSheetTexture(4);
    const sheet = new Texture({ source: frames[0].source });

    const flipping = new ParticleContainer3D({
      texture: sheet,
      capacity: 4,
      extraBits: [particleLifetimeBit, particleFlipbookOverLifeBit],
    });

    view3d.root.addChild(flipping);
    flipping.uniforms.uParticleTime = 4;
    flipping.uniforms.uFlipbookGrid = [4, 1, 4];

    for (let i = 0; i < 4; i++) {
      flipping.setParticle(i, {
        aPosition: { x: (i - 1.5) * 1.6, y: -1.3, z: 0 },
        aParticleSizeRot: { x: 1.2, y: 0 },
        aParticleColor: 0xff5533,
        aBirth: 4 - 4 * (i / 4 + 0.05),
        aLife: 4,
      });
    }

    flipping.upload();
  },
};
