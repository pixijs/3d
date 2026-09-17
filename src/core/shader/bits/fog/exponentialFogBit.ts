import type { ShaderBit } from '../../ShaderBit';

/**
 * Exponential distance fog
 *
 *     factor = 1 - exp(-density * depth)
 *
 * Density-driven falloff that approaches the fog colour asymptotically.
 * Compared with `exp2Fog`, the curve has a heavier near-camera
 * contribution, so scenes look fogged from the start of the view. Good
 * for soft haze.
 *
 * Runs in linear radiance, before any tone-mapping bit — `uFogColor` arrives
 * already decoded and scaled by exposure.
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
  // uFogParams = (near, far, density); exponential reads density.
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
