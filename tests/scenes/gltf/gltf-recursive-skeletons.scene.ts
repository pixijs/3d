import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.RecursiveSkeletons');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason: "Only the rest pose renders; the reference shows an animated frame, so the skinning can't be judged",
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
