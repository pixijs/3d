import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Spins a particle in its quad's plane at `aSpin` radians per second, from its spawn rotation
 *
 * Compose it after {@link particleLifetimeBit}.
 * @category scene
 * @advanced
 */
export const particleSpinBit = {
  name: 'particleSpin',

  attributes: {
    aSpin: 'float32',
  },

  gpu: {
    vertex: {
      beforeTransform: /*wgsl*/ `
  particleRotation += input.aSpin * particleAge;
`,
    },
  },

  gl: {
    vertex: {
      beforeTransform: /*glsl*/ `
  particleRotation += aSpin * particleAge;
`,
    },
  },
} satisfies ShaderBit;
