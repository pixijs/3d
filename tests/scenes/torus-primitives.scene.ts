import type { TestScene } from '@test-utils';

import { TorusGeometry } from '~/geometry/TorusGeometry';
import { TorusKnotGeometry } from '~/geometry/TorusKnotGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: {
    backgroundColor: 0xf4f1ea,
  },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    app.stage.addChild(view3d);

    const torus = new Mesh3D({
      geometry: new TorusGeometry({ radius: 0.55, tube: 0.18, radialSegments: 24, tubularSegments: 72 }),
      material: new Material3D({ baseColor: 0x1f6f8b, metallic: 0, roughness: 0.45 }),
      castShadow: false,
      receiveShadow: false,
    });

    torus.position.set(-0.72, 0, 0);
    torus.rotation.set(-0.2, 0.35, 0);

    const knot = new Mesh3D({
      geometry: new TorusKnotGeometry({ radius: 0.48, tube: 0.12, tubularSegments: 96, radialSegments: 14 }),
      material: new Material3D({ baseColor: 0xb84a62, metallic: 0, roughness: 0.38 }),
      castShadow: false,
      receiveShadow: false,
    });

    knot.position.set(0.72, 0, 0);
    knot.rotation.set(-0.25, -0.25, 0.15);

    view3d.root.addChild(torus, knot);

    const light = new DirectionalLight({ color: 0xffffff, intensity: 8 });

    light.rotation.set(-0.65, 0.55, 0.25);
    view3d.root.addChild(light);

    view3d.camera.position.set(0, 0, 2.7);
  },
};
