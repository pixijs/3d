import type { ShaderBit } from '../../ShaderBit';

/**
 * Exponential distance fog, `factor = 1 - exp(-density * depth)`
 *
 * `depth` is the fragment's view-space depth and `density` is `uFogParams.z`. The fog nears its
 * colour without reaching it, and starts thickening right at the camera, sooner than
 * `exp2FogBit`'s.
 *
 * It runs after exposure and before tone mapping, as `linearFogBit` describes.
 * @internal
 */
export const exponentialFogBit: ShaderBit = {
  name: 'exponentialFog',

  interStage: {
    vFogDepth: 'f32',
  },

  gpu: {
    vertex: {
      afterTransform: /*wgsl*/ `
  output.vFogDepth = -(camera.uViewMatrix * worldPosition).z;
`,
    },
    fragment: {
      end: /*wgsl*/ `
  let fogFactor = 1.0 - exp(-global.uFogParams.z * input.vFogDepth);
  finalColor = mix(finalColor, global.uFogColor, fogFactor);
`,
    },
  },

  gl: {
    vertex: {
      afterTransform: /*glsl*/ `
  vFogDepth = -(uViewMatrix * worldPosition).z;
`,
    },
    fragment: {
      end: /*glsl*/ `
  float fogFactor = 1.0 - exp(-uFogParams.z * vFogDepth);
  finalColor = mix(finalColor, uFogColor, fogFactor);
`,
    },
  },
};
