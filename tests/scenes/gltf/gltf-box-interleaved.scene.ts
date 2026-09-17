import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.BoxInterleaved');

/**
 * Basic glTF model regression — BoxInterleaved.
 *
 * Loaded remotely from KhronosGroup/glTF-Sample-Models. Exercises vertex attributes interleaved into a single buffer view.
 */
export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
