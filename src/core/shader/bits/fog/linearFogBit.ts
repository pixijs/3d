import type { ShaderBit } from '../../ShaderBit';

/** @internal */
export const linearFogBit: ShaderBit = {
  name: 'linearFog',

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
  let fogFactor = smoothstep(global.uFogParams.x, global.uFogParams.y, input.vFogDepth);
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
  float fogFactor = smoothstep(uFogParams.x, uFogParams.y, vFogDepth);
  finalColor = mix(finalColor, uFogColor, fogFactor);
`,
    },
  },
};
