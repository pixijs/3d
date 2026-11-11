import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.TextureLinearInterpolationTest');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason: 'The textured sphere renders darker than the real-factor sphere; they should match',
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
