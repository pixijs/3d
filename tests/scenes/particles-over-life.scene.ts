import type { TestScene } from '@test-utils';

import { ConeShape } from '~/extras/particles/emitterShapes/ConeShape';
import { ParticleSystem3D } from '~/extras/particles/ParticleSystem3D';
import { View3D } from '~/scene/View3D';

import { puffTexture } from './helpers/particleTextures';

// A ballistic fountain with every over-life ramp on at once: particles grow,
// fade, shift from hot orange to cool blue, arc under gravity and slow under
// drag. Deterministic — fixed seed, fixed steps, no ticker.
export const scene: TestScene = {
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    app.stage.addChild(view3d);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 1.5, 9);
    view3d.camera.lookAt({ x: 0, y: 1.2, z: 0 });

    const system = new ParticleSystem3D({
      texture: puffTexture(),
      blendMode: 'add',
      capacity: 300,
      seed: 'over-life',
      autoUpdate: false,
      emitRate: 90,
      shape: new ConeShape({ angle: 28, radius: 0.15 }),
      life: [1.6, 2.4],
      speed: [5, 7],
      size: [0.18, 0.32],
      sizeEnd: [0.7, 1.1],
      alpha: 0.85,
      alphaEnd: 0,
      color: 0xffb040,
      colorEnd: 0x2a66ff,
      spin: [-3, 3],
      gravity: 4,
      drag: 0.2,
    });

    system.position.set(0, -1.6, 0);
    view3d.root.addChild(system);

    for (let step = 0; step < 180; step++) system.update();
  },
};
