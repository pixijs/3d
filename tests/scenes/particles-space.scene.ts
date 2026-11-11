import type { TestScene } from '@test-utils';

import { ConeShape } from '~/extras/particles/emitterShapes/ConeShape';
import { ParticleSystem3D } from '~/extras/particles/ParticleSystem3D';
import { seededRandom } from '~/math/utils/seededRandom';
import type { ParticleSpace } from '~/scene/particles/ParticleContainer3D';
import { View3D } from '~/scene/View3D';

import { puffTexture } from './helpers/particleTextures';

const STEPS = 90;
const SWEEP = 3.2;

export const scene: TestScene = {
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    app.stage.addChild(view3d);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 0, 10);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    (['world', 'local'] as ParticleSpace[]).forEach((space, i) => {
      const system = new ParticleSystem3D({
        texture: puffTexture(),
        space,
        blendMode: 'add',
        capacity: 200,
        createRandom: () => seededRandom('space'),
        autoUpdate: false,
        emitRate: 60,
        shape: new ConeShape({ angle: 20, radius: 0.05 }),
        life: 2,
        speed: 0.6,
        size: 0.35,
        alpha: 0.7,
        color: i === 0 ? 0x66ccff : 0xffaa55,
      });

      view3d.root.addChild(system);

      const row = 1.8 - i * 3.6;

      for (let step = 0; step < STEPS; step++) {
        const x = Math.sin((step / STEPS) * Math.PI * 2) * SWEEP;

        system.position.set(x, row, 0);
        system.update();
      }
    });
  },
};
