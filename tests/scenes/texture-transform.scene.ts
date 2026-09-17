import type { TestScene } from '@test-utils';
import { Assets, Container } from 'pixi.js';

import type { Scene3DSource } from '~/assets/Scene3DSource';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Model3D } from '~/scene/Model3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  assets: ['TextureTransformMultiTest.glb'],
  create: async (app, _context) => {
    const container = new Container();
    app.stage.addChild(container);

    const source = Assets.get<Scene3DSource>('TextureTransformMultiTest.glb');
    const model = new Model3D(source);

    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    container.addChild(view3d);
    view3d.root.addChild(model);

    const light = new DirectionalLight({ color: 0xffffff, intensity: 5 });
    view3d.root.addChild(light);

    const camera = view3d.camera;
    camera.position.set(0, 0, 3);
  },
};
