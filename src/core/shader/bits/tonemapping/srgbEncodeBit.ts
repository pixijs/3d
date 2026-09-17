import type { ShaderBit } from '../../ShaderBit';

/**
 * Linear → sRGB display encode with no tone-mapping curve
 *
 * Backs the `toneMapping: 'none'` mode: the scene keeps its linear lighting
 * (no ACES/Reinhard/Uncharted shoulder) but is still encoded to sRGB, so
 * on-screen output is correct rather than dark. This is what most callers want
 * from "no tone-mapping". Keep this encode in sync with the curve bits' final
 * `pow(x, 1/2.2)` line.
 *
 * To skip the encode entirely — raw linear output for a user-owned post-process
 * or output transform — use `toneMapping: 'custom'`, which adds no fragment-end
 * bit at all.
 * @internal
 */
export const srgbEncodeBit: ShaderBit = {
  name: 'srgbEncode',

  gpu: {
    fragment: {
      end: `
  // sRGB display encode (linear → sRGB), no tone-mapping curve.
  finalColor = pow(finalColor, vec3<f32>(1.0 / 2.2));
`,
    },
  },

  gl: {
    fragment: {
      end: `
  // sRGB display encode (linear → sRGB), no tone-mapping curve.
  finalColor = pow(finalColor, vec3(1.0 / 2.2));
`,
    },
  },
};
