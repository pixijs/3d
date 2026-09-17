import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.Duck');

/**
 * Basic glTF model regression — Duck.
 *
 * Loaded remotely from KhronosGroup/glTF-Sample-Models. Exercises a classic single-mesh textured model with authored normals.
 */
export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
