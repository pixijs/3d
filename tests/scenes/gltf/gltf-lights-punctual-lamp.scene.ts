import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.LightsPunctualLamp');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason: 'The glass shade renders darker and greyer than three.js at the same camera',
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
