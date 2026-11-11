import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.TransmissionTest');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason:
    'WebGL renders transmissive surfaces black; on WebGPU the see-through gaps of transmission with alpha render black where three.js shows the background',
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
