import type { ShaderBit } from '../../ShaderBit';

/** @internal */
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
