import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.StainedGlassLamp');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason:
    'The stained glass renders milky white on both backends; three.js at the same camera shows saturated colour',
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
