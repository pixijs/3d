import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.TextureTransformTest');

// Skipped on WebGPU: ignores the model's CLAMP_TO_EDGE sampler, so the transformed textures tile.
export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: ['webgpu'],
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
