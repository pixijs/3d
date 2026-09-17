import type { ShaderBit } from '../../ShaderBit';

/**
 * Linear distance fog
 *
 * Fades fragments toward `uFogColor` between `uFogParams.x` (near, no
 * fog) and `uFogParams.y` (far, full fog). View-space depth is computed
 * once per vertex and interpolated as `vFogDepth`.
 *
 * Runs in linear radiance, before any tone-mapping bit — `uFogColor` arrives
 * already decoded and scaled by exposure, so the mix and the scene share one
 * space and one curve.
 *
 * The factor uses `smoothstep` (rather than a plain clamp) for C¹
 * continuity at the near/far boundaries — gives a slightly softer
 * falloff at both ends.
 * @internal
 */
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
  // uFogParams = (near, far, density); linear reads near + far.
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
