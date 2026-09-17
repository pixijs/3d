import type { TestScene } from '@test-utils';

import { SsaoEffect } from '~/extras/post-processing/effects/SsaoEffect';
import { TintEffect } from '~/extras/post-processing/effects/TintEffect';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * `[tint, ssao]` — a two-effect chain: tint writes an intermediate transient,
 * SSAO's merge samples it (chain input) × its blurred AO and presents.
 *
 * Same AO corner as effect-ssao.scene.ts, warm-tinted; the AO must darken the
 * *tinted* image identically to how it darkens the untinted one — a chain
 * mis-order shows as AO missing or double-applied.
 */

const SIZE = 200;

export const scene: TestScene = {
  app: {
    width: 340,
    height: 260,
    backgroundColor: 0x242c36,
  },
  delay: 120,
  create: async (app) => {
    const view = new View3D({
      width: SIZE,
      height: SIZE,
      anchor: 0.5,
      toneMapping: 'none',
      environment: { skyColor: 0xffffff, groundColor: 0x445566 },
      passes: [
        new TintEffect({ tint: 0xffcc99 }),
        new SsaoEffect({ radius: 0.8, intensity: 2, samples: 24, power: 1.6 }),
      ],
    });
    view.camera.fov = 45;
    view.camera.position.set(2.6, 3.0, 4.2);
    view.camera.lookAt({ x: 0, y: 0.4, z: 0 });

    view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.55 }));

    const boxMaterial = new Material3D({ baseColor: 0xb8c4d4, roughness: 0.85, metallic: 0 });
    const positions = [
      { x: -0.75, y: 0.5, z: 0 },
      { x: 0.45, y: 0.5, z: 0.35 },
      { x: -0.1, y: 0.5, z: -0.95 },
      { x: -0.15, y: 1.5, z: -0.3 },
    ];
    for (const p of positions) {
      const box = new Mesh3D({ geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }), material: boxMaterial });
      box.position.set(p.x, p.y, p.z);
      view.root.addChild(box);
    }

    const ball = new Mesh3D({
      geometry: new SphereGeometry({ radius: 0.5 }),
      material: new Material3D({ baseColor: 0xd0a878, roughness: 0.6, metallic: 0 }),
    });
    ball.position.set(1.5, 0.5, -0.6);
    view.root.addChild(ball);

    const floor = new Mesh3D({
      geometry: new PlaneGeometry({ width: 10, height: 10 }),
      material: new Material3D({ baseColor: 0x9aa6b5, roughness: 0.95 }),
    });
    floor.rotation.set(-Math.PI / 2, 0, 0);
    view.root.addChild(floor);

    view.position.set(170, 130);
    app.stage.addChild(view);
  },
};
