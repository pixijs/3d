import type { ShaderBit } from '../../core/shader/ShaderBit';

/**
 * Runs in the vertex `end` slot to read the clip position the draw rasterises. Only WGSL negates `y`, as row 0
 * sits at NDC `y` +1 there and -1 on WebGL; the ±1 clamp keeps a `w` near zero from overflowing `rg16float`
 * @internal
 */
export const velocityBit: ShaderBit = {
  name: 'velocity',
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
  output.vPreviousClip = (camera.uPreviousViewProjectionMatrix * worldPosition).xyw;`,
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
  vPreviousClip = (uPreviousViewProjectionMatrix * worldPosition).xyw;`,
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
