import type { TestScene } from '@test-utils';
import { Assets, Container } from 'pixi.js';

import type { Scene3DSource } from '~/assets/Scene3DSource';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Model3D } from '~/scene/Model3D';
import { View3D } from '~/scene/View3D';

import { model } from '../../examples/assets/manifest';

const UNNORMALIZED_DUCK = model('gltf.DuckQuantized');
const NORMALIZED_SHADER_BALL = model('gltf.ShaderBall');

export const scene: TestScene = {
  assets: [UNNORMALIZED_DUCK, NORMALIZED_SHADER_BALL],
  create: async (app, _context) => {
    const container = new Container();
    app.stage.addChild(container);

    const source = Assets.get<Scene3DSource>(UNNORMALIZED_DUCK);
    const model = new Model3D(source);
    model.position.set(-0.85, -0.85, 0);

    const ball = new Model3D(Assets.get<Scene3DSource>(NORMALIZED_SHADER_BALL));
    ball.scale.set(0.5, 0.5, 0.5);
    ball.position.set(0.85, -0.85, 0);

    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    container.addChild(view3d);
    view3d.root.addChild(model, ball);

    const light = new DirectionalLight({
      color: 0xffffff,
      intensity: 10,
    });

    view3d.root.addChild(light);

    const camera = view3d.camera;
    camera.position.set(0, 0, 3);
  },
};
