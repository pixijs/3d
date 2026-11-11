import type { TestScene } from '@test-utils';

import { SsaoEffect } from '~/extras/post-processing/effects/SsaoEffect';
import { View3D } from '~/scene/View3D';

import { scene as depthNormals } from './effect-ssao.scene';

export const scene: TestScene = {
  ...depthNormals,
  create: async (app, context) => {
    await depthNormals.create(app, context);
    const view = app.stage.children.find((child) => child instanceof View3D)!;
    view.passes = [new SsaoEffect({ radius: 0.8, intensity: 2, samples: 24, power: 1.6, sceneNormals: true })];
  },
};
