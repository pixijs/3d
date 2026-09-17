import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.Box');

/**
 * Basic glTF model regression — Box.
 *
 * Loaded remotely from KhronosGroup/glTF-Sample-Models. Exercises an untextured multi-primitive box rendered with the default PBR metallic-roughness material.
 */
export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
