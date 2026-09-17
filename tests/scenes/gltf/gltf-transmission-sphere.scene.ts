import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.TransmissionSphere');

// Skipped on WebGL: transmissive surfaces render black; WebGPU refracts.
export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: ['webgl'],
  // Longer settle than the 100ms default to test whether it stabilises this WebGPU snapshot.
  delay: 100,
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
