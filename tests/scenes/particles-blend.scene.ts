import type { TestScene } from '@test-utils';

import { ParticleSystem3D } from '~/extras/particles/ParticleSystem3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { seededRandom } from '~/math/utils/seededRandom';
import { Mesh3D } from '~/scene/Mesh3D';
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
      material: new FlatMaterial({ baseColor: 0xafb7c6 }),
    });

    wall.position.set(0, 0, -2);
    view3d.root.addChild(wall);

    const texture = puffTexture();

    (
      [
        ['normal', 0xff5533],
        ['add', 0xff5533],
      ] as const
    ).forEach(([blendMode, color], i) => {
      const system = new ParticleSystem3D({
        texture,
        blendMode,
        color,
        createRandom: () => seededRandom(`blend-${blendMode}`),
        capacity: 8,
        autoUpdate: false,
        emitRate: 0,
        life: 100,
        size: 1.8,
        alpha: 0.55,
      });

      view3d.root.addChild(system);

      const cx = (i - 0.5) * 4.4;

      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;

        system.spawn(1, { position: { x: cx + Math.cos(a) * 0.7, y: Math.sin(a) * 0.7, z: 0 } });
      }
    });
  },
};
