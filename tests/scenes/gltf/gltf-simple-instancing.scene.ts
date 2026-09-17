import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.SimpleInstancing');

// Skipped: EXT_mesh_gpu_instancing isn't supported; only the source mesh draws.
export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
