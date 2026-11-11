import type { TestScene } from '@test-utils';

import { PointShape } from '~/extras/particles/emitterShapes/PointShape';
import { ParticleSystem3D } from '~/extras/particles/ParticleSystem3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import type { AlphaMode } from '~/materials/BaseMaterial3D';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { seededRandom } from '~/math/utils/seededRandom';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import { wedgeTexture } from './helpers/particleTextures';

const COLUMNS: { alphaMode: AlphaMode; color: number }[] = [
  { alphaMode: 'blend', color: 0xffaa44 },
  { alphaMode: 'mask', color: 0x66ddff },
  { alphaMode: 'opaque', color: 0xcc88ff },
];

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

    COLUMNS.forEach(({ alphaMode, color }, i) => {
      const x = (i - 1) * 2.8;
      const sphere = new Mesh3D({
        geometry: new SphereGeometry({ radius: 0.8 }),
        material: new FlatMaterial({ baseColor: 0x8a919f }),
      });

      sphere.position.set(x, 0, 0);
      view3d.root.addChild(sphere);

      const system = new ParticleSystem3D({
        texture,
        alphaMode,
        alphaCutoff: 0.5,
        blendMode: alphaMode === 'mask' ? 'add' : 'normal',
        color,
        capacity: 8,
        createRandom: () => seededRandom(`alpha-${alphaMode}`),
        autoUpdate: false,
        emitRate: 0,
        shape: new PointShape(),
        life: 100,
        speed: 0,
        size: 1.1,
        alpha: 0.85,
      });

      view3d.root.addChild(system);

      for (let p = 0; p < 6; p++) {
        system.spawn(1, { position: { x, y: 1.9 - p * 0.76, z: p % 2 === 0 ? 0.5 : -0.5 } });
      }

      system.time = 0.5;
    });
  },
};
