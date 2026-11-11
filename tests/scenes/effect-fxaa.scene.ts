import type { TestScene } from '@test-utils';

import { FxaaEffect } from '~/extras/post-processing/effects/FxaaEffect';
import { CubeGeometry } from '~/geometry/CubeGeometry';
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
    backgroundColor: 0x10141a,
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
      passes: [new FxaaEffect()],
    });
    view.camera.fov = 45;
    view.camera.position.set(0, 1.2, 4.5);
    view.camera.lookAt({ x: 0, y: 0, z: 0 });

    view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.4 }));

    const sphere = new Mesh3D({
      geometry: new SphereGeometry({ radius: 0.7 }),
      material: new Material3D({ baseColor: 0xffcc66, roughness: 0.5, metallic: 0 }),
    });
    sphere.position.set(-0.7, 0, 0);
    view.root.addChild(sphere);

    const barGeometry = new CubeGeometry({ width: 2, height: 0.06, depth: 0.06 });
    const barMaterial = new Material3D({ baseColor: 0xffffff, roughness: 0.6, metallic: 0 });
    for (let i = 0; i < 5; i++) {
      const bar = new Mesh3D({ geometry: barGeometry, material: barMaterial });
      bar.position.set(0.8, -0.6 + i * 0.3, 0.2);
      bar.rotation.set(0, 0, 0.04 + i * 0.12);
      view.root.addChild(bar);
    }

    const floor = new Mesh3D({
      geometry: new PlaneGeometry({ width: 4, height: 4 }),
      material: new Material3D({ baseColor: 0x6688aa, roughness: 0.9 }),
    });
    floor.rotation.set(-Math.PI / 2, 0.3, 0);
    floor.position.set(0, -0.75, 0);
    view.root.addChild(floor);

    view.position.set(170, 130);
    app.stage.addChild(view);
  },
};
