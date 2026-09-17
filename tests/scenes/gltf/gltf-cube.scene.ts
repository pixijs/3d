import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.Cube');

/**
 * Basic glTF model regression — Cube.
 *
 * Loaded remotely from KhronosGroup/glTF-Sample-Models. Exercises normal mapping with base-color, metallic-roughness and normal textures resolved as remote relative URIs alongside a .gltf + .bin.
 */
export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
