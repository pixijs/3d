import type { TestScene } from '@test-utils';

import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import { solidTexture } from './helpers/solidTexture';

export const scene: TestScene = {
  app: { backgroundColor: 0x14161c },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height, toneMapping: 'aces' });

    app.stage.addChild(view3d);

    const panelWithCollapsedTriangle = new Geometry3D({
      positions: new Float32Array([-1.5, -1.5, 0, 1.5, 1.5, 0, -1.5, 1.5, 0, -1.5, -1.5, 0, 1.5, -1.5, 0, 1.5, 1.5, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 1, 1, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]),
    });
    const panel = new Mesh3D({
      geometry: panelWithCollapsedTriangle,
      material: new Material3D({
        baseColor: 0xcfd6de,
        metallic: 0,
        roughness: 0.6,
        normalTexture: solidTexture('rgb(200, 160, 220)'),
      }),
    });

    view3d.root.addChild(panel);

    const sun = new DirectionalLight({ color: 0xfff2e0, intensity: 3 });

    sun.position.set(-3, 2, 4);
    sun.lookAt({ x: 0, y: 0, z: 0 });
    view3d.root.addChild(sun);

    view3d.camera.position.set(0, 0, 6);
  },
};
