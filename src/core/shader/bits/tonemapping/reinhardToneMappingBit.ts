import type { ShaderBit } from '../../ShaderBit';

/**
 * Reinhard tone mapping with gamma correction
 *
 * The simplest curve: `color / (color + 1)`. Cheap, but can look washed out —
 * suited to quick prototyping and simple scenes.
 * @internal
 */
export const reinhardToneMappingBit: ShaderBit = {
  name: 'reinhardToneMapping',

  gpu: {
    fragment: {
      end: `
  // Reinhard tone mapping
  finalColor = finalColor / (finalColor + vec3<f32>(1.0));

  // Gamma correction (linear → sRGB)
  finalColor = pow(finalColor, vec3<f32>(1.0 / 2.2));
`,
    },
  },

  gl: {
    fragment: {
      end: `
  // Reinhard tone mapping
  finalColor = finalColor / (finalColor + vec3(1.0));

  // Gamma correction (linear → sRGB)
  finalColor = pow(finalColor, vec3(1.0 / 2.2));
`,
    },
  },
};
