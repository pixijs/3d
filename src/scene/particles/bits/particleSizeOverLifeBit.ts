import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Ramps a particle's size from its spawn value to `aSizeEnd` across its life
 *
 * Compose it after {@link particleLifetimeBit}.
 * @category scene
 * @advanced
 */
export const particleSizeOverLifeBit = {
  name: 'particleSizeOverLife',

  attributes: {
    aSizeEnd: 'float32',
  },

  gpu: {
    vertex: {
      beforeTransform: /*wgsl*/ `
  particleSize = mix(particleSize, input.aSizeEnd, particleProgress);
`,
    },
  },

  gl: {
    vertex: {
      beforeTransform: /*glsl*/ `
  particleSize = mix(particleSize, aSizeEnd, particleProgress);
`,
    },
  },
} satisfies ShaderBit;
