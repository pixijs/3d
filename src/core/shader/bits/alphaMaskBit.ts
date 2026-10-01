import type { ShaderBit } from '../ShaderBit';

/**
 * The cutout for `alphaMode: 'mask'`: discards fragments with alpha below the material's
 * `alphaCutoff` and makes the rest fully opaque
 *
 * glTF defines `MASK` output as "either fully opaque or fully transparent", so partial alpha from a
 * soft-edged texture mustn't reach the blend. List it after the bit that sets `alpha` from the base
 * colour.
 * @category rendering
 * @advanced
 */
export const alphaMaskBit: ShaderBit = {
  name: 'alphaMask',
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
