import type { ShaderBit } from '../ShaderBit';
import { baseAlphaBit } from './baseAlphaBit';

/**
 * The cutout for `alphaMode: 'mask'`: discards fragments with alpha below the material's
 * `alphaCutoff` and makes the rest fully opaque
 *
 * glTF defines `MASK` output as "either fully opaque or fully transparent", so partial alpha from a
 * soft-edged texture mustn't reach the blend.
 *
 * It is `'cutout'`, so a pass at that level keeps it, as the shadow pass does to cut holes in a
 * shadow. It requires {@link baseAlphaBit}, which sets the `alpha` it compares, so that bit and
 * the texture read behind it come into such a pass with it and with nothing else.
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
