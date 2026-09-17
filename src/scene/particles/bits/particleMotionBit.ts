import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Ballistic motion with linear drag, in closed form
 *
 * Where a particle is after `particleAge` seconds given its launch velocity,
 * the system's gravity and the system's drag. Velocity, gravity and drag are
 * one bit because drag couples the other two; with drag the exact position is
 *
 * ```text
 * p = p0 + v · a + g · b
 * a = (1 − e^(−kt)) / k          → t     as k → 0
 * b = (t − a) / k                → t²/2  as k → 0
 * ```
 *
 * so neither the velocity term nor the gravity term can be added on its own.
 * `k` below a small threshold takes the drag-free form directly, which is both
 * the exact limit and the way to dodge the `1/k` precision loss.
 *
 * Reads `particleAge` from {@link particleLifetimeBit}, so that bit must be
 * composed first. `aPosition` is the launch point; this bit moves `position`
 * from it.
 * @category scene
 * @advanced
 */
export const particleMotionBit = {
  name: 'particleMotion',

  attributes: {
    aVel: 'float32x3',
  },

  bindings: {
    material: {
      uGravity: 'vec3<f32>',
      uDrag: 'f32',
    },
  },

  gpu: {
    vertex: {
      beforeTransform: /*wgsl*/ `
  {
    let k = material.uDrag;
    let t = particleAge;
    var a = t;
    var b = t * t * 0.5;

    if (k > 1e-4) {
      a = (1.0 - exp(-k * t)) / k;
      b = (t - a) / k;
    }

    position = vec4<f32>(position.xyz + input.aVel * a + material.uGravity * b, 1.0);
  }
`,
    },
  },

  gl: {
    vertex: {
      beforeTransform: /*glsl*/ `
  {
    float k = material.uDrag;
    float t = particleAge;
    float a = t;
    float b = t * t * 0.5;

    if (k > 1e-4) {
      a = (1.0 - exp(-k * t)) / k;
      b = (t - a) / k;
    }

    position = vec4(position.xyz + aVel * a + material.uGravity * b, 1.0);
  }
`,
    },
  },
} satisfies ShaderBit;
