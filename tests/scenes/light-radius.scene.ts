import type { TestScene } from '@test-utils';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { PointLight } from '~/scene/lights/PointLight';
import { SpotLight } from '~/scene/lights/SpotLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const HEIGHT = 0.25;

export const scene: TestScene = {
  app: { backgroundColor: 0x101014 },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    app.stage.addChild(view3d);

    const floor = new Mesh3D({
      geometry: new PlaneGeometry({ width: 12, height: 12 }),
      material: new Material3D({ baseColor: 0xb0b0b0, metallic: 0, roughness: 1 }),
    });

    floor.rotation.x = -Math.PI / 2;
    view3d.root.addChild(floor);

    const lights = [
      new PointLight({ intensity: 3, range: 2.2 }),
      new PointLight({ intensity: 3, range: 2.2, radius: 0.6 }),
      new PointLight({ intensity: 3, range: 2.2, radius: 1 }),
      new SpotLight({ intensity: 3, range: 2.2, radius: 0.6, coneAngle: 75, penumbra: 0.5 }),
    ];

    lights[0].position.set(-1.6, HEIGHT, -1.6);
    lights[1].position.set(1.6, HEIGHT, -1.6);
    lights[2].position.set(-1.6, HEIGHT, 1.6);
    lights[3].position.set(1.6, HEIGHT, 1.6);
    lights[3].rotation.x = -Math.PI / 2;

    for (const light of lights) view3d.root.addChild(light);

    view3d.camera.position.set(0, 7, 2);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  },
};
