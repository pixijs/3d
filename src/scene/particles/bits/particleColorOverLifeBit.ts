import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Ramps a particle's tint from its spawn colour to `aColorEnd` across its life
 *
 * `aColorEnd` takes `{ x, y, z, w }`, each 0 to 1 in display (sRGB) space, not a `ColorSource`;
 * `w` is unused, since {@link particleAlphaOverLifeBit} ramps opacity. Compose it after
 * {@link particleLifetimeBit}.
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
