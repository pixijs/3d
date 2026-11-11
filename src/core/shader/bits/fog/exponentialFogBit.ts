import type { ShaderBit } from '../../ShaderBit';

/** @internal */
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
