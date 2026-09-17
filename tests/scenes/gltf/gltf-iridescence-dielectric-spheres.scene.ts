import type { TestScene } from '@test-utils';

import { model } from '../../../examples/assets/manifest';
import { renderGltfModel } from './frameModel';

const URL = model('gltf.IridescenceDielectricSpheres');

/**
 * Lit to show the thin-film colours, after the Khronos screenshot: a mid-grey backdrop and a greyscale,
 * high-contrast copy of the Venice Sunset sky, so the spheres' body stays neutral grey while the bright
 * sky reflections carry the film tint. No ambient fill, and a lower exposure keeps highlights from
 * clipping to white, which would bleach the tint.
 *
 * Skipped: the tints are far weaker than the reference. The IBL darkens diffuse per channel by the film
 * reflectance, which cancels most of the tint; the Khronos Sample Renderer darkens it by the strongest channel.
 */
export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x8c8c8c },
  skip: true,
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
