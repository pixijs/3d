import type { TestScene } from '@test-utils';

import { OutlinePass } from '~/extras/post-processing/passes/OutlinePass';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: {
    width: 400,
    height: 240,
    backgroundColor: 0x1a1a2e,
  },
  create: async (app) => {
    const view = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      shadowQuality: 'medium',
      passes: [new OutlinePass({ width: 0.08, color: 0x9effd8 })],
    });
    app.stage.addChild(view);

    view.camera.fov = 40;
    view.camera.position.set(0, 3.2, 6.5);
    view.camera.lookAt({ x: 0, y: 0.3, z: 0 });

    view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.3 }));
    const sun = new DirectionalLight({ color: 0xfff4e0, intensity: 4, castShadow: true });
    sun.rotation.set((-50 * Math.PI) / 180, (25 * Math.PI) / 180, 0);
    view.root.addChild(sun);

    const floor = new Mesh3D({
      geometry: new PlaneGeometry({ width: 10, height: 6 }),
      material: new Material3D({ baseColor: 0x8899aa, roughness: 0.9 }),
      castShadow: false,
    });
    floor.rotation.set(-Math.PI / 2, 0, 0);
    view.root.addChild(floor);

    const geometry = new SphereGeometry({ radius: 0.5 });
    const material = new Material3D({ baseColor: 0xd4b483, roughness: 0.6 });
    const spheres = [-2.4, -0.8, 0.8, 2.4].map((x) => {
      const sphere = new Mesh3D({ geometry, material });
      sphere.position.set(x, 0.9, 0);
      view.root.addChild(sphere);
      return sphere;
    });

    spheres[1].enablePass('outline');
    spheres[2].disablePass('opaque');
    spheres[3].disablePass('opaque');
    spheres[3].enablePass('outline');
  },
};
