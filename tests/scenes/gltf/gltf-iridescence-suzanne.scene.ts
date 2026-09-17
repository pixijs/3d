import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.IridescenceSuzanne');

// Skipped on WebGL: transmissive surfaces render black, so the clear third head is opaque; WebGPU matches three.js.
export const scene: TestScene = {
  assets: [URL],
  // Mid-grey backdrop matching the Khronos screenshot, so thin-film tints and transmission read against it.
  app: { backgroundColor: 0x8c8c8c },
  skip: ['webgl'],
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
