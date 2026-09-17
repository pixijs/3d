import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Spins a particle about the view axis at `aSpin` radians per second
 *
 * Reads `particleAge` from {@link particleLifetimeBit} and adds to the
 * `particleRotation` local the particle bit seeds from the spawn rotation.
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
