import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Moves each particle from its launch point along a ballistic path, worked out on the GPU
 *
 * `aPosition` is the launch point and `aVel` the launch velocity, per particle. The container's
 * `uGravity` uniform is the acceleration, and `uDrag` the linear drag per second, 0 for none.
 * Compose it after {@link particleLifetimeBit}.
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
