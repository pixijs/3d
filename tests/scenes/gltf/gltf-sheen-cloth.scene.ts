import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.SheenCloth');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason: "The sheen adds purple streaks through the folds that three.js at the same camera doesn't show",
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
