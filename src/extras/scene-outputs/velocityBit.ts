import { previousModelMatrixBit } from '../../core/shader/bits/previousModelMatrixBit';
import type { ShaderBit } from '../../core/shader/ShaderBit';

/**
 * Runs in the vertex `end` slot to read the clip position the draw rasterises. Only WGSL negates `y`, as row 0
 * sits at NDC `y` +1 there and -1 on WebGL; the ±1 clamp keeps a `w` near zero from overflowing `rg16float`.
 * It adds the mesh's move to `worldPosition` rather than transforming `previousPosition` alone, so a still billboard,
 * which rewrites `worldPosition`, reads as still; the material systems declare `previousPosition`
 * @internal
 */
export const velocityBit: ShaderBit = {
  name: 'velocity',
  requires: [previousModelMatrixBit],
  outputs: {
    velocity: 'vec2<f32>',
  },
  interStage: {
    vCurrentClip: 'vec3<f32>',
    vPreviousClip: 'vec3<f32>',
  },
  gpu: {
    vertex: {
      end: /* wgsl */ `
  output.vCurrentClip = clipPosition.xyw;
  output.vPreviousClip = (camera.uPreviousViewProjectionMatrix * (worldPosition + previousModelMatrix * previousPosition - modelMatrix * position)).xyw;`,
    },
    fragment: {
      end: /* wgsl */ `
  {
    let currentNdc = input.vCurrentClip.xy / input.vCurrentClip.z;
    let previousNdc = input.vPreviousClip.xy / input.vPreviousClip.z;
    outputs.velocity = clamp((currentNdc - previousNdc) * vec2<f32>(0.5, -0.5), vec2<f32>(-1.0), vec2<f32>(1.0));
  }`,
    },
  },
  gl: {
    vertex: {
      end: /* glsl */ `
  vCurrentClip = gl_Position.xyw;
  vPreviousClip = (uPreviousViewProjectionMatrix * (worldPosition + previousModelMatrix * previousPosition - modelMatrix * position)).xyw;`,
    },
    fragment: {
      end: /* glsl */ `
  {
    vec2 currentNdc = vCurrentClip.xy / vCurrentClip.z;
    vec2 previousNdc = vPreviousClip.xy / vPreviousClip.z;
    outputs.velocity = clamp((currentNdc - previousNdc) * 0.5, -1.0, 1.0);
  }`,
    },
  },
};
