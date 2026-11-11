import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.SimpleMaterial');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason: 'A mesh whose geometry has only a POSITION attribute draws nothing',
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
