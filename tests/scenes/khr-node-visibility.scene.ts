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

    const shown = new Model3D(source);
    shown.scale.set(10, 10, 10);
    shown.position.set(-0.3, -0.21, 0);

    const hidden = new Model3D(source);
    hidden.scale.set(10, 10, 10);
    hidden.position.set(0.3, -0.21, 0);
    hidden.visible = false;

    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      shadowQuality: 'high',
    });

    container.addChild(view3d);
    view3d.root.addChild(shown);
    view3d.root.addChild(hidden);

    const sun = new DirectionalLight({ color: 0xffffff, intensity: 10 });
    view3d.root.addChild(sun);

    view3d.camera.position.set(0, 0, 1);
  },
};
