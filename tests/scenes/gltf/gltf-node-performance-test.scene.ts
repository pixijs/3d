import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.NodePerformanceTest');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  // WebGPU shading drifts ~100px run-to-run on this dense node grid; WebGL is deterministic and held to the
  // default tolerance. The WebGPU-only bound absorbs the drift without masking a WebGL regression.
  pixelMatchWebgpu: 200,
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
