import type { ShaderBit } from '../../core/shader/ShaderBit';

/**
 * Runs in the fragment `end` slot to write the normal that lighting used, after normal maps, flat
 * shading and the back-face flip
 * @internal
 */
export const normalOutputBit: ShaderBit = {
  name: 'normalOutput',
  outputs: {
    normal: 'vec4<f32>',
  },
  gpu: {
    fragment: {
      end: /* wgsl */ `
  outputs.normal = vec4<f32>(normalize((camera.uViewMatrix * vec4<f32>(normal, 0.0)).xyz) * 0.5 + 0.5, 1.0);`,
    },
  },
  gl: {
    fragment: {
      end: /* glsl */ `
  outputs.normal = vec4(normalize((uViewMatrix * vec4(normal, 0.0)).xyz) * 0.5 + 0.5, 1.0);`,
    },
  },
};
