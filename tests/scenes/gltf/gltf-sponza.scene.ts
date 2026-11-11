import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.Sponza');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason: "Interior scene: the auto-framed camera sits outside the building, so the render can't be judged",
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
