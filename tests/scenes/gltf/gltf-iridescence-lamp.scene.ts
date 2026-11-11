import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.IridescenceLamp');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: ['webgl'],
  skipReason: 'transmissive surfaces render black; WebGPU refracts',
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
