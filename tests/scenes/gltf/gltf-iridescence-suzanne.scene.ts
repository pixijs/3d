import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.IridescenceSuzanne');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x8c8c8c },
  skip: ['webgl'],
  skipReason: 'transmissive surfaces render black, so the clear third head is opaque; WebGPU matches three.js',
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
