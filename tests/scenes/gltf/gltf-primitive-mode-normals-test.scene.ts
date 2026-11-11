import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.PrimitiveModeNormalsTest');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason: 'WebGL draws no points or lines; point and line topologies turn the whole WebGPU frame black',
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
