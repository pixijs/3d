import type { ShaderBit } from '../../ShaderBit';

/**
 * Distance fog that fades from none at `uFogParams.x`, the near distance, to full at
 * `uFogParams.y`, the far one
 *
 * The factor is `smoothstep(near, far, depth)` rather than a clamped line, so it eases in and out
 * at both ends with no visible crease.
 *
 * All three fog bits work the same way. The vertex stage writes the view-space depth into
 * `vFogDepth`, and the fragment stage mixes `finalColor` toward `uFogColor`. The mix runs after
 * exposure and before tone mapping, and `uFogColor` arrives decoded to linear and scaled by the
 * exposure, so the fog and the scene share one space and one curve. `uFogParams` is
 * `(near, far, density)`: the linear fog reads the first two and the exponential ones the third.
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
