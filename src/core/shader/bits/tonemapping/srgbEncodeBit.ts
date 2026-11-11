import type { ShaderBit } from '../../ShaderBit';

/**
 * Every curve bit ends with this `pow(x, 1 / 2.2)`, and every 2.2 decode, on the GPU or the CPU,
 * inverts it, so change them together
 * @internal
 */
export const srgbEncodeBit: ShaderBit = {
  name: 'srgbEncode',

  gpu: {
    fragment: {
      end: `
  finalColor = pow(finalColor, vec3<f32>(1.0 / 2.2));
`,
    },
  },

  gl: {
    fragment: {
      end: `
  finalColor = pow(finalColor, vec3(1.0 / 2.2));
`,
    },
  },
};
