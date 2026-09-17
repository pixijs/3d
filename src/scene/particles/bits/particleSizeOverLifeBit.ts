import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Ramps a particle's size from its spawn value to `aSizeEnd` across its life
 *
 * Reads `particleProgress` from {@link particleLifetimeBit} and the spawn size
 * from the `particleSize` local the particle bit seeds, then assigns the
 * blend back. The end size is per particle so a burst can vary it.
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
