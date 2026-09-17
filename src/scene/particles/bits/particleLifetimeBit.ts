import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Gives every particle a clock: when it was born, how long it lives, and how
 * far through that it is right now
 *
 * The base every stateless particle behaviour reads from.
 *
 * Declares `aBirth` and `aLife` per particle and `uParticleTime` per system,
 * and derives two locals for later bits:
 *
 * - `particleAge` — seconds since birth. Negative before the particle is born.
 * - `particleProgress` — age over lifetime, clamped to `[0, 1]`, so every ramp
 *   can blend on it without clamping again.
 *
 * A particle that is not yet born or already dead is removed in
 * `afterTransform` by collapsing its clip position to a point outside the
 * frustum. That slot runs after every bit that writes size or tint, so a ramp
 * assigning `particleSize` cannot bring a dead particle back. Nothing on the
 * CPU tracks liveness; a particle is written once at birth and the shader
 * decides every frame whether it exists.
 *
 * Time is the system's own `uParticleTime` rather than the global clock so a
 * system can be paused or scrubbed, and so a capture is deterministic.
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
      // beforeTransform rather than input: on WebGL the material struct only
      // comes into scope after the input slot, and the particle bit's size local
      // is declared in this slot just ahead of us. Both backends use the same
      // slot so the two sources stay line-for-line.
      beforeTransform: /*wgsl*/ `
  let particleAge = material.uParticleTime - input.aBirth;
  // A zero lifetime is an unwritten slot; the max keeps its progress finite
  // rather than NaN, so it reads as long dead and later bits see a number.
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
