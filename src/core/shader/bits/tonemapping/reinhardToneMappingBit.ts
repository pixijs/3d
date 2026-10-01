import type { ShaderBit } from '../../ShaderBit';

/**
 * Reinhard tone mapping, `x / (x + 1)` per channel, then the display encode `srgbEncodeBit`
 * describes
 *
 * It is the cheapest curve. It halves an input of 1 and only nears white for very bright input, so
 * scenes tend to look flat.
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
