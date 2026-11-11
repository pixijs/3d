import type { TestScene } from '@test-utils';
import { Assets, Container } from 'pixi.js';

import type { Scene3DSource } from '~/assets/Scene3DSource';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Model3D } from '~/scene/Model3D';
import { View3D } from '~/scene/View3D';

import { model } from '../../examples/assets/manifest';

const AVOCADO = model('gltf.Avocado');

export const scene: TestScene = {
  assets: [AVOCADO],
  create: async (app, _context) => {
    const container = new Container();
    app.stage.addChild(container);

    const source = Assets.get<Scene3DSource>(AVOCADO);
    const model = new Model3D(source);

    model.scale.set(10, 10, 10);
    model.position.set(0, -0.21, 0);

    const view3d = new View3D({ width: app.screen.width, height: app.screen.height, shadowQuality: 'high' });

    container.addChild(view3d);
    view3d.root.addChild(model);

    const light2 = new DirectionalLight({
      color: 0xffffff,
      intensity: 10,
    });

    view3d.root.addChild(light2);

    const camera = view3d.camera;
    camera.position.set(0, 0, 1);
  },
};
