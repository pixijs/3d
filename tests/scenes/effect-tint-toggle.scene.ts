import type { TestScene } from '@test-utils';

import { TintEffect } from '~/extras/post-processing/effects/TintEffect';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 200;

export const scene: TestScene = {
  app: {
    width: 340,
    height: 260,
    backgroundColor: 0x242c36,
  },
  delay: 160,
  create: async (app) => {
    const tint = new TintEffect({ tint: 0xff6666, enabled: false });

    const view = new View3D({
      width: SIZE,
      height: SIZE,
      anchor: 0.5,
      toneMapping: 'none',
      environment: { skyColor: 0xffffff, groundColor: 0x223344 },
      passes: [tint],
    });
    view.camera.fov = 45;
    view.camera.position.set(0, 1.4, 4);
    view.camera.lookAt({ x: 0, y: 0, z: 0 });

    view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.35 }));

    const sphere = new Mesh3D({
      geometry: new SphereGeometry({ radius: 0.9 }),
      material: new Material3D({ baseColor: 0x77aaff, roughness: 0.35, metallic: 0 }),
    });
    view.root.addChild(sphere);

    const floor = new Mesh3D({
      geometry: new PlaneGeometry({ width: 6, height: 6 }),
      material: new Material3D({ baseColor: 0x8899aa, roughness: 0.9 }),
    });
    floor.rotation.set(-Math.PI / 2, 0, 0);
    floor.position.set(0, -0.95, 0);
    view.root.addChild(floor);

    view.position.set(170, 130);
    app.stage.addChild(view);

    setTimeout(() => {
      tint.enabled = true;
    }, 40);
  },
};
