import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Gives every particle a clock, which the other lifetime bits read
 *
 * Each particle carries its `aBirth` time and `aLife` length in seconds, and you advance the
 * container's `uParticleTime` uniform yourself, so you can pause or scrub the system. A particle
 * draws only from its birth until its life runs out.
 *
 * Bits composed after it can read two locals in their `beforeTransform` or later: `particleAge`,
 * seconds since birth, and `particleProgress`, age over life from 0 to 1.
 * @category scene
 * @advanced
 */
export const particleLifetimeBit = {
  name: 'particleLifetime',

  attributes: {
    aBirth: 'float32',
    aLife: 'float32',
  },

  bindings: {
    material: {
      uParticleTime: 'f32',
    },
  },

  gpu: {
    vertex: {
      beforeTransform: /*wgsl*/ `
  let particleAge = material.uParticleTime - input.aBirth;
  let particleProgress = clamp(particleAge / max(input.aLife, 1e-6), 0.0, 1.0);
`,
      afterTransform: /*wgsl*/ `
  if (particleAge < 0.0 || particleAge > input.aLife) {
    clipPosition = vec4<f32>(0.0, 0.0, 2.0, 1.0);
  }
`,
    },
  },

  gl: {
    vertex: {
      beforeTransform: /*glsl*/ `
  float particleAge = material.uParticleTime - aBirth;
  float particleProgress = clamp(particleAge / max(aLife, 1e-6), 0.0, 1.0);
`,
      afterTransform: /*glsl*/ `
  if (particleAge < 0.0 || particleAge > aLife) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  }
`,
    },
  },
} satisfies ShaderBit;
