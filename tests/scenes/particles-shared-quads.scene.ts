import type { TestScene } from '@test-utils';

import { PointShape } from '~/extras/particles/emitterShapes/PointShape';
import { ParticleSystem3D } from '~/extras/particles/ParticleSystem3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { seededRandom } from '~/math/utils/seededRandom';
import { Mesh3D } from '~/scene/Mesh3D';
import { ensureQuadBuffers } from '~/scene/particles/utils/particleGeometry';
import { View3D } from '~/scene/View3D';

import { wedgeTexture } from './helpers/particleTextures';

export const scene: TestScene = {
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    app.stage.addChild(view3d);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 0, 9);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    const wall = new Mesh3D({
      geometry: new PlaneGeometry({ width: 14, height: 10 }),
      material: new FlatMaterial({ baseColor: 0x2a2f3a }),
    });

    wall.position.set(0, 0, -2);
    view3d.root.addChild(wall);

    const texture = wedgeTexture();
    const column = (capacity: number, x: number, color: number): ParticleSystem3D => {
      const system = new ParticleSystem3D({
        texture,
        capacity,
        color,
        createRandom: () => seededRandom(`shared-${capacity}`),
        autoUpdate: false,
        emitRate: 0,
        alphaMode: 'mask',
        shape: new PointShape(),
        life: 100,
        speed: 0,
        size: 0.9,
      });

      view3d.root.addChild(system);

      for (let p = 0; p < 6; p++) system.spawn(1, { position: { x, y: 1.9 - p * 0.76, z: 0 } });

      system.time = 0.5;

      return system;
    };

    column(8, -2.5, 0xffaa44);
    column(4096, 2.5, 0x66ddff);

    let frames = 0;

    app.renderer.runners.postrender.add({
      postrender: () => {
        if (++frames !== 2) return;
        ensureQuadBuffers(ensureQuadBuffers(1).capacity + 1);
      },
    });
  },
};
