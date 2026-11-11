import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.EmissiveFireflies');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason: 'KHR_animation_pointer channels have no `target.node`; processAnimations throws on load',
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
