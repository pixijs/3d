import type { TestScene } from '@test-utils';
import { Assets } from 'pixi.js';

import type { Scene3DSource } from '~/assets/Scene3DSource';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Model3D } from '~/scene/Model3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  assets: ['skinned-shared-rig.glb'],
  app: { backgroundColor: 0x1e2024 },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    const source = Assets.get<Scene3DSource>('skinned-shared-rig.glb');
    const model = new Model3D({ source, autoUpdate: false });
    view3d.root.addChild(model);

    model.player!.getState('wave').gotoAndStop(0.5);

    const key = new DirectionalLight({ color: 0xffffff, intensity: 6 });
    key.rotation.set(-0.8, 0.5, 0);
    view3d.root.addChild(key);

    const fill = new DirectionalLight({ color: 0xbcd0ff, intensity: 2 });
    fill.rotation.set(-0.2, -0.9, 0);
    view3d.root.addChild(fill);

    view3d.camera.position.set(3, 3, 5);
    view3d.camera.lookAt({ x: 0.3, y: 1.2, z: 0 });
  },
};
