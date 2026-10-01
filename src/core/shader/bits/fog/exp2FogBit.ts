import type { ShaderBit } from '../../ShaderBit';

/**
 * Exponential-squared distance fog, `factor = 1 - exp(-(density * depth)²)`
 *
 * `depth` is the fragment's view-space depth and `density` is `uFogParams.z`. Squaring keeps the
 * fog thinner than `exponentialFogBit`'s while `density * depth` is below 1 and thicker past it,
 * so the camera's surroundings stay clear and the distance fades out.
 *
 * It runs after exposure and before tone mapping, as `linearFogBit` describes.
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
