import type { ShaderBit } from '../ShaderBit';

/**
 * Declared `float32x3` for any buffer format: quantized normals arrive normalized, and both
 * backends read the first three components
 * @internal
 */
export const normalBit: ShaderBit = {
  name: 'normal',

  attributes: {
    aNormal: 'float32x3',
  },

  gpu: {
    vertex: {
      input: 'normal = input.aNormal;',
    },
  },

  gl: {
    vertex: {
      input: 'normal = aNormal;',
    },
  },
};
