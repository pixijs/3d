import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.BoxVertexColors');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason: 'The primitive has no material and the default material leaves `vertexColors` off, so COLOR_0 is ignored',
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
