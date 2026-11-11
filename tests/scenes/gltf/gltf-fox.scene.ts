import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.Fox');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason:
    "Geometry without NORMAL gets one constant normal instead of flat per-face normals, so facets don't shade",
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
