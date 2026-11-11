import type { TestScene } from '@test-utils';
import { uid } from 'pixi.js';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const UID_GAP = 0x1000;

export const scene: TestScene = {
  app: {
    backgroundColor: 0x14161a,
  },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    const cube = new CubeGeometry({ width: 1.6, height: 1.6, depth: 1.6 });
    for (let i = 0; i < UID_GAP - 1; i++) uid('geometry');
    const sphere = new SphereGeometry({ radius: 1 });

    const material = new Material3D({ baseColor: 0xffffff, metallic: 0, roughness: 0.45 });

    const left = new Mesh3D({ geometry: cube, material, castShadow: false, receiveShadow: false });
    left.position.set(-1.5, 0, 0);
    view3d.root.addChild(left);

    const right = new Mesh3D({ geometry: sphere, material, castShadow: false, receiveShadow: false });
    right.position.set(1.5, 0, 0);
    view3d.root.addChild(right);

    const light = new DirectionalLight({ color: 0xffffff, intensity: 5 });
    light.rotation.set(-0.7, 0.6, 0.2);
    view3d.root.addChild(light);

    view3d.camera.position.set(0, 1.6, 6.5);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  },
};
