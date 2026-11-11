import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: { backgroundColor: 0x101018 },
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      shadowQuality: 'medium',
    });
    app.stage.addChild(view3d);

    const ground = new Mesh3D({
      geometry: new PlaneGeometry({ width: 24, height: 24 }),
      material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
      castShadow: false,
    });
    ground.position.set(0, -0.5, 0);
    ground.rotation.set(-Math.PI / 2, 0, 0);
    view3d.root.addChild(ground);

    const sun = new DirectionalLight({
      color: 0xfff4e0,
      intensity: 6,
      castShadow: true,
    });
    sun.rotation.set((-40 * Math.PI) / 180, (30 * Math.PI) / 180, 0);
    view3d.root.addChild(sun);

    view3d.camera.position.set(0, 7, 11);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    const cube = new CubeGeometry({ width: 1.2, height: 1.2, depth: 1.2 });
    const material = new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.4 });
    const addCaster = (geometry: CubeGeometry | SphereGeometry, casterMaterial: Material3D, x: number, z: number) => {
      const mesh = new Mesh3D({ geometry, material: casterMaterial });
      mesh.position.set(x, 0, z);
      view3d.root.addChild(mesh);
      return mesh;
    };

    const row = [-6, -3, 0, 3, 6].map((x) => addCaster(cube, material, x, 0));
    app.render();

    addCaster(cube, new Material3D({ baseColor: 0xc05a3c, metallic: 0, roughness: 0.4 }), -6, -4);
    addCaster(new SphereGeometry({ radius: 0.8, widthSegments: 24, heightSegments: 12 }), material, -3, -4);
    view3d.root.removeChild(row[3]);
    app.render();

    view3d.root.removeChild(row[4]);
    app.render();
    view3d.root.addChild(row[4]);
  },
};
