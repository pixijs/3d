import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.IridescenceDielectricSpheres');

export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x8c8c8c },
  skip: true,
  skipReason:
    'the tints are far weaker than the reference. The IBL darkens diffuse per channel by the film reflectance, which cancels most of the tint; the Khronos Sample Renderer darkens it by the strongest channel',
  create: async (app) => {
    await renderGltfModel(app, {
      url: URL,
      environmentUrl: '/venice-sunset-grey/venice-sunset-grey.cubemap',
      ambientIntensity: 0,
      lightIntensity: Math.PI * 0.6,
      exposure: 0.65,
    });
  },
};
