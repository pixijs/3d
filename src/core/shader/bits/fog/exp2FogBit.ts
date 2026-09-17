import type { ShaderBit } from '../../ShaderBit';

/**
 * Exponential-squared distance fog
 *
 *     factor = 1 - exp(-(density * depth)²)
 *
 * The squared term flattens out the near-camera contribution and
 * concentrates the falloff in the mid/far field — gives a more
 * "atmospheric" haze that doesn't desaturate fragments right in front
 * of the camera. Standard choice for outdoor / atmospheric scenes.
 *
 * Runs in linear radiance, before any tone-mapping bit — `uFogColor` arrives
 * already decoded and scaled by exposure.
 * @internal
 */
export const exp2FogBit: ShaderBit = {
  name: 'exp2Fog',

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
  // uFogParams = (near, far, density); exp2 reads density.
  let fogD = global.uFogParams.z * input.vFogDepth;
  let fogFactor = 1.0 - exp(-fogD * fogD);
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
  float fogD = uFogParams.z * vFogDepth;
  float fogFactor = 1.0 - exp(-fogD * fogD);
  finalColor = mix(finalColor, uFogColor, fogFactor);
`,
    },
  },
};
