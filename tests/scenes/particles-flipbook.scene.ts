import type { TestScene } from '@test-utils';

import { ParticleSystem3D } from '~/extras/particles/ParticleSystem3D';
import type { ParticleFrameMode } from '~/extras/particles/ParticleSystem3D';
import { seededRandom } from '~/math/utils/seededRandom';
import { View3D } from '~/scene/View3D';

import { ringSheetTexture } from './helpers/particleTextures';

const MODES: { frameMode: ParticleFrameMode; life: number; color: number }[] = [
  { frameMode: 'random', life: 4, color: 0xffaa44 },
  { frameMode: 'animate', life: 4, color: 0x66ddff },
  { frameMode: 'overLife', life: 3.2, color: 0xcc88ff },
];

const SPAWN_STEP = 0.6;

export const scene: TestScene = {
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    app.stage.addChild(view3d);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 0, 9);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    const frames = ringSheetTexture(8, 64, 4);

    MODES.forEach((mode, i) => {
      const system = new ParticleSystem3D({
        texture: frames,
        frameMode: mode.frameMode,
        frameRate: 2,
        capacity: 8,
        createRandom: () => seededRandom(`flipbook-${mode.frameMode}`),
        autoUpdate: false,
        emitRate: 0,
        life: mode.life,
        size: 0.9,
        color: mode.color,
      });

      view3d.root.addChild(system);

      for (let p = 0; p < 6; p++) {
        system.spawn(1, { position: { x: (i - 1) * 2.7, y: 1.6 - p * 0.65, z: 0 } });
        system.time += SPAWN_STEP;
      }

      system.upload();
    });
  },
};
