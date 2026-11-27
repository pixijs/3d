import type { ShaderBit } from '../ShaderBit';
import { baseAlphaBit } from './baseAlphaBit';

/**
 * The cutout for `alphaMode: 'mask'`: discards fragments with alpha below the material's
 * `alphaCutoff` and makes the rest fully opaque
 *
 * Its level is `'cutout'`, so the shadow pass keeps it and a masked mesh's shadow has its holes.
 * It requires {@link baseAlphaBit}, which sets the `alpha` it compares.
 * @category rendering
 * @advanced
 */
export const alphaMaskBit: ShaderBit = {
  name: 'alphaMask',
  level: 'cutout',
  requires: [baseAlphaBit],
  bindings: {
    material: {
      alphaCutoff: 'f32',
    },
  },
  gpu: {
    fragment: {
      material: /*wgsl*/ `
  if (alpha < material.alphaCutoff) {
    discard;
  }
  alpha = 1.0;
`,
    },
  },
  gl: {
    fragment: {
      material: /*glsl*/ `
  if (alpha < material.alphaCutoff) discard;
  alpha = 1.0;
`,
    },
  },
};
