import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.SheenWoodLeatherSofa');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason: 'EXT_texture_webp textures have no core `source`; processTextures throws on load',
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
