import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.MosquitoInAmber');

// Skipped on WebGL: transmissive surfaces render black; WebGPU refracts.
export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: ['webgl'],
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
