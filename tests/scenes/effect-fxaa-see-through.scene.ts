import type { TestScene } from '@test-utils';

import { FxaaEffect } from '~/extras/post-processing/effects/FxaaEffect';
import { OutlinePass } from '~/extras/post-processing/passes/OutlinePass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 200;

export const scene: TestScene = {
  app: {
    width: 340,
    height: 260,
    backgroundColor: 0xf2efe8,
    antialias: false,
  },
  delay: 120,
  create: async (app) => {
    const view = new View3D({
      width: SIZE,
      height: SIZE,
      anchor: 0.5,
      toneMapping: 'none',
      environment: { skyColor: 0xffffff, groundColor: 0x334455 },
      passes: [new OutlinePass(), new FxaaEffect()],
    });
    view.camera.fov = 45;
    view.camera.position.set(0, 0, 4.5);

    const key = new DirectionalLight({ color: 0xffffff, intensity: 3 });
    key.position.set(3, 5, 4);
    key.lookAt({ x: 0, y: 0, z: 0 });
    view.root.addChild(key);

    const sphere = new Mesh3D({
      geometry: new SphereGeometry({ radius: 0.6, widthSegments: 48, heightSegments: 32 }),
      material: new Material3D({ baseColor: 0xff7733, roughness: 0.5, passes: { outline: true } }),
    });
    sphere.position.set(-0.85, 0, 0);
    view.root.addChild(sphere);

    const barGeometry = new CubeGeometry({ width: 1.8, height: 0.06, depth: 0.06 });
    const railing = new FlatMaterial({ baseColor: 0x040506 });
    const white = new FlatMaterial({ baseColor: 0xffffff });
    for (let i = 0; i < 5; i++) {
      const bar = new Mesh3D({ geometry: barGeometry, material: i === 4 ? white : railing });
      bar.position.set(0.75, 0.6 - i * 0.3, 0);
      bar.rotation.set(0, 0, 0.03 + i * 0.06);
      view.root.addChild(bar);
    }

    view.position.set(170, 130);
    app.stage.addChild(view);
  },
};
