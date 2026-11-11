import type { ShaderBit } from '../ShaderBit';

/**
 * Must follow the material's bits, so its `end` code overrides any alpha they write
 * @internal
 */
export const alphaOpaqueBit: ShaderBit = {
  name: 'alphaOpaque',
  gpu: {
    fragment: {
      end: /*wgsl*/ `
  alpha = 1.0;
`,
    },
  },
  gl: {
    fragment: {
      end: /*glsl*/ `
  alpha = 1.0;
`,
    },
  },
};
