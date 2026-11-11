import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.MeshPrimitiveModes');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason:
    'Position-only primitives draw nothing on WebGL; point and line topologies turn the whole WebGPU frame black',
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
