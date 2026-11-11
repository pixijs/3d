import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.SimpleOpacity');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason: 'glTF 1.0 asset; the loader only reads glTF 2.0 and throws on load',
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
