import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.SheenDamask');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason:
    'The sheen draws a hard bright-blue outline where three.js shows a soft rim; TEXCOORD_1 occlusion reads UV0',
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
