import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Ramps a particle's opacity from its spawn value to `aAlphaEnd` across its
 * life — the standard fade-out when the end is zero
 *
 * Reads `particleProgress` from {@link particleLifetimeBit} and writes the
 * alpha channel of the `particleColor` local the particle bit seeds.
 * @category scene
 * @advanced
 */
export const particleAlphaOverLifeBit = {
  name: 'particleAlphaOverLife',

  attributes: {
    aAlphaEnd: 'float32',
  },

  gpu: {
    vertex: {
      beforeTransform: /*wgsl*/ `
  particleColor.a = mix(particleColor.a, input.aAlphaEnd, particleProgress);
`,
    },
  },

  gl: {
    vertex: {
      beforeTransform: /*glsl*/ `
  particleColor.a = mix(particleColor.a, aAlphaEnd, particleProgress);
`,
    },
  },
} satisfies ShaderBit;
