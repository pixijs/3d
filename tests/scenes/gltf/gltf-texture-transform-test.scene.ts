import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.TextureTransformTest');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: ['webgpu'],
  skipReason: "ignores the model's CLAMP_TO_EDGE sampler, so the transformed textures tile",
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
