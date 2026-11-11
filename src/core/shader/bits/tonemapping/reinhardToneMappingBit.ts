import type { ShaderBit } from '../../ShaderBit';

/**
 * Ends with the display encode, which must match `srgbEncodeBit`
 * @internal
 */
export const reinhardToneMappingBit: ShaderBit = {
  name: 'reinhardToneMapping',

  gpu: {
    fragment: {
      end: `
  finalColor = finalColor / (finalColor + vec3<f32>(1.0));

  finalColor = pow(finalColor, vec3<f32>(1.0 / 2.2));
`,
    },
  },

  gl: {
    fragment: {
      end: `
  finalColor = finalColor / (finalColor + vec3(1.0));

  finalColor = pow(finalColor, vec3(1.0 / 2.2));
`,
    },
  },
};
