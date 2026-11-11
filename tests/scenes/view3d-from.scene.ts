import type { TestScene } from '@test-utils';
import { Assets } from 'pixi.js';

import type { Scene3DSource } from '~/assets/Scene3DSource';
import { View3D } from '~/scene/View3D';

import { model } from '../../examples/assets/manifest';

const AVOCADO = model('gltf.Avocado');

export const scene: TestScene = {
  assets: [AVOCADO],
  create: async (app) => {
    const source = Assets.get<Scene3DSource>(AVOCADO);

    app.stage.addChild(View3D.from(source, { width: app.screen.width, height: app.screen.height }));
  },
};
