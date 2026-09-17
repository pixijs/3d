import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.SciFiHelmet');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
