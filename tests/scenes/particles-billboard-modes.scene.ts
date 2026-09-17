import type { TestScene } from '@test-utils';

import { ParticleSystem3D } from '~/extras/particles/ParticleSystem3D';
import type { ParticleBillboardMode } from '~/scene/particles/bits/particleBit';
import { View3D } from '~/scene/View3D';

import { wedgeTexture } from './helpers/particleTextures';

// The three orientations, one row each, viewed from a raised camera so they
// can't be confused: spherical squares up to the lens, cylindrical stays
// upright and only turns about Y, and 'horizontal' lies flat on the ground.
// Particles are placed by hand and hold still — this scene is about geometry,
// not motion.
const ROWS: { billboard: ParticleBillboardMode; color: number; rotation: number }[] = [
  { billboard: 'spherical', color: 0xff7744, rotation: 0 },
  { billboard: 'spherical', color: 0xffcc33, rotation: Math.PI / 4 },
  { billboard: 'cylindrical', color: 0x55ddff, rotation: 0 },
  { billboard: 'horizontal', color: 0x99ff66, rotation: 0 },
];

const COLUMNS = [-2.4, 0, 2.4];

export const scene: TestScene = {
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    app.stage.addChild(view3d);

    view3d.camera.fov = 45;
    view3d.camera.position.set(4, 6.5, 10);
    view3d.camera.lookAt({ x: 0, y: -0.5, z: 0 });

    const texture = wedgeTexture();

    ROWS.forEach((row, r) => {
      const system = new ParticleSystem3D({
        texture,
        billboard: row.billboard,
        capacity: COLUMNS.length,
        seed: 'billboard',
        autoUpdate: false,
        emitRate: 0,
        life: 100,
        size: 1.4,
        color: row.color,
        startRotation: row.rotation,
      });

      view3d.root.addChild(system);

      const z = (r - 1.5) * 2.4;

      for (const x of COLUMNS) system.spawn(1, { position: { x, y: 0, z } });
    });
  },
};
