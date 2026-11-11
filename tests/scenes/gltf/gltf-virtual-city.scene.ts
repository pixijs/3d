import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.VirtualCity');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason: "The auto-framed camera sits outside the sky box, so the city can't be judged",
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
