import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Ramps a particle's tint from its spawn colour to `aColorEnd` across its life
 *
 * Reads `particleProgress` from {@link particleLifetimeBit} and blends the RGB
 * of the `particleColor` local the particle bit seeds, leaving alpha to
 * {@link particleAlphaOverLifeBit}. `aColorEnd` is a normalized `unorm8x4`
 * holding linear RGB, the same encoding as the spawn tint, so the two blend in
 * one space.
 * @category scene
 * @advanced
 */
export const particleColorOverLifeBit = {
  name: 'particleColorOverLife',

  attributes: {
    aColorEnd: 'unorm8x4',
  },

  gpu: {
    vertex: {
      beforeTransform: /*wgsl*/ `
  particleColor = vec4<f32>(mix(particleColor.rgb, input.aColorEnd.rgb, particleProgress), particleColor.a);
`,
    },
  },

  gl: {
    vertex: {
      beforeTransform: /*glsl*/ `
  particleColor.rgb = mix(particleColor.rgb, aColorEnd.rgb, particleProgress);
`,
    },
  },
} satisfies ShaderBit;
