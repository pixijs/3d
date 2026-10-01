import type { ShaderBit } from '../../ShaderBit';

/**
 * The display encode on its own, with no tone-mapping curve, for `toneMapping: 'none'`
 *
 * The scene's lighting stays linear but still goes out encoded for display, so it doesn't look
 * dark. `toneMapping: 'custom'` adds no bit at all and leaves the output linear, for a
 * post-process or output transform of your own.
 *
 * The encode is `pow(x, 1 / 2.2)`, and every curve bit ends with the same line, so keep them in
 * step. It costs less than the piecewise sRGB curve. The two agree within 1.5 of 255 above linear
 * 0.1, but the power curve lifts the deepest shadows, by up to 8.5 of 255 near linear 0.002.
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
