import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.TextureEncodingTest');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason:
    'The custom-gamma texture renders dark and the ICC-profile texture renders red; every column should match',
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
