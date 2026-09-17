import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.TextureEncodingTest');

// Skipped: The custom-gamma texture renders dark and the ICC-profile texture renders red; every column should match.
export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
