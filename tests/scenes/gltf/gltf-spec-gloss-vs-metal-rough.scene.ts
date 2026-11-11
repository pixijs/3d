import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.SpecGlossVsMetalRough');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  skip: true,
  skipReason: "KHR_materials_pbrSpecularGlossiness isn't supported; the spec-gloss bottle renders white",
  create: async (app) => {
    await renderGltfModel(app, { url: URL });
  },
};
