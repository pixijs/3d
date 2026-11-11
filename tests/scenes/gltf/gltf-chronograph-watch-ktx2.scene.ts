import type { TestScene } from '@test-utils';
import { Assets, extensions, loadKTX2 } from 'pixi.js';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.ChronographWatchKtx2');

export const scene: TestScene = {
  app: { backgroundColor: 0x191919 },
  create: async (app) => {
    extensions.add(loadKTX2);

    try {
      await Assets.load(URL);
    } finally {
      extensions.remove(loadKTX2);
    }

    await renderGltfModel(app, { url: URL });
  },
};
