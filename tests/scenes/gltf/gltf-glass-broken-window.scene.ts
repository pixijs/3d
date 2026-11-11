import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.GlassBrokenWindow');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: ['webgl'],
  skipReason:
    "transmissive surfaces render black; WebGPU refracts. The hole in the glass draws as a dark patch, not an opening. The asset's glass is MASK with transmission, and the loader turns that into OPAQUE, so the cut-out is lost",
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
