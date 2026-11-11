import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const COLUMNS = [-3.2, 0, 3.2];
const YAWS = [0.9, 0, -0.6];

export const scene: TestScene = {
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 4.5, 10);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    view3d.root.addChild(new AmbientLight({ color: 0x2a3040, intensity: 1 }));

    const key = new DirectionalLight({ color: 0xffffff, intensity: 3.5 });
    key.position.set(4, 8, 6);
    key.lookAt({ x: 0, y: 0, z: 0 });
    view3d.root.addChild(key);

    const ground = new Mesh3D({
      geometry: new PlaneGeometry({ width: 20, height: 20 }),
      material: new FlatMaterial({ baseColor: 0x14181f }),
    });
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2.6;
    view3d.root.addChild(ground);

    const geometry = new CubeGeometry({ width: 1.6, height: 1.6, depth: 1.6 });
    const material = new Material3D({ baseColor: 0xd8d2c4, metallic: 0, roughness: 0.6 });

    COLUMNS.forEach((x, i) => {
      const reference = new Mesh3D({ geometry, material, billboardMode: 'none' });
      reference.position.set(x, 1.6, 0);
      reference.rotation.y = YAWS[i];
      view3d.root.addChild(reference);

      const billboarded = new Mesh3D({ geometry, material, billboardMode: 'cylindrical' });
      billboarded.position.set(x, -1.2, 0);
      billboarded.rotation.y = YAWS[i];
      view3d.root.addChild(billboarded);
    });
  },
};
