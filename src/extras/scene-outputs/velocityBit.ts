import type { ShaderBit } from '../../core/shader/ShaderBit';

/**
 * Runs in the vertex `end` slot to read the clip position the draw rasterises. Only WGSL negates `y`, as row 0 sits
 * at NDC `y` +1 there and -1 on WebGL
 * @internal
 */
const cameraMotionBit: ShaderBit = {
  name: 'cameraMotion',
  interStage: {
    vCurrentClip: 'vec3<f32>',
    vPreviousClip: 'vec3<f32>',
  },
  gpu: {
    header: /* wgsl */ `
fn cameraMotionUv(currentClip: vec3<f32>, previousClip: vec3<f32>) -> vec2<f32> {
  return (currentClip.xy / currentClip.z - previousClip.xy / previousClip.z) * vec2<f32>(0.5, -0.5);
}`,
    vertex: {
      end: /* wgsl */ `
  output.vCurrentClip = clipPosition.xyw;
  output.vPreviousClip = (camera.uPreviousViewProjectionMatrix * worldPosition).xyw;`,
    },
  },
  gl: {
    header: /* glsl */ `
vec2 cameraMotionUv(vec3 currentClip, vec3 previousClip) {
  return (currentClip.xy / currentClip.z - previousClip.xy / previousClip.z) * 0.5;
}`,
    vertex: {
      end: /* glsl */ `
  vCurrentClip = gl_Position.xyw;
  vPreviousClip = (uPreviousViewProjectionMatrix * worldPosition).xyw;`,
    },
  },
};

/**
 * The ±1 clamp keeps a `w` near zero from overflowing `rg16float`
 * @internal
 */
export const velocityBit: ShaderBit = {
  name: 'velocity',
  requires: [cameraMotionBit],
  outputs: {
    velocity: 'vec2<f32>',
  },
  gpu: {
    fragment: {
      end: /* wgsl */ `
  outputs.velocity = clamp(cameraMotionUv(input.vCurrentClip, input.vPreviousClip), vec2<f32>(-1.0), vec2<f32>(1.0));`,
    },
  },
  gl: {
    fragment: {
      end: /* glsl */ `
  outputs.velocity = clamp(cameraMotionUv(vCurrentClip, vPreviousClip), -1.0, 1.0);`,
    },
  },
};

/**
 * Clamps to the largest `rgba16float` value, so a `w` near zero reads a huge motion rather than an infinity that an
 * antialiased resolve can average into NaN
 * @internal
 */
export const reprojectionVelocityBit: ShaderBit = {
  name: 'reprojectionVelocity',
  requires: [cameraMotionBit],
  outputs: {
    reprojectionVelocity: 'vec4<f32>',
  },
  gpu: {
    fragment: {
      end: /* wgsl */ `
  outputs.reprojectionVelocity = vec4<f32>(clamp(cameraMotionUv(input.vCurrentClip, input.vPreviousClip), vec2<f32>(-65504.0), vec2<f32>(65504.0)), 0.0, 0.0);`,
    },
  },
  gl: {
    fragment: {
      end: /* glsl */ `
  outputs.reprojectionVelocity = vec4(clamp(cameraMotionUv(vCurrentClip, vPreviousClip), -65504.0, 65504.0), 0.0, 0.0);`,
    },
  },
};
