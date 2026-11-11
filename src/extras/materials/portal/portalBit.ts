import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Only a material with `_skipsToneCurve` set may use it, or the view's tone curve runs over the feed a second time
 * @internal
 */
export const portalBit: ShaderBit = {
  name: 'portal',

  textures: ['portal'],

  bindings: {
    material: {
      baseColor: 'vec4<f32>',
      displayBaseColor: 'vec4<f32>',
    },
  },

  gpu: {
    header: /*wgsl*/ `
fn portalScreenUV(worldPos: vec3<f32>) -> vec2<f32> {
  let clip = camera.uViewProjectionMatrix * vec4<f32>(worldPos, 1.0);
  let ndc = clip.xy / clip.w;
  return vec2<f32>(ndc.x * 0.5 + 0.5, 1.0 - (ndc.y * 0.5 + 0.5));
}
`,
    fragment: {
      material: /*wgsl*/ `
  let portalFeed = samplePortal(portalScreenUV(input.vPosition));
  let portalTint = inputTint(material.baseColor, material.displayBaseColor);

  albedo *= decodeFrame(portalFeed.rgb) * portalTint.rgb;
  alpha *= portalTint.a;
`,
    },
  },

  gl: {
    header: /*glsl*/ `
vec2 portalScreenUV(vec3 worldPos) {
  vec4 clip = uViewProjectionMatrix * vec4(worldPos, 1.0);
  vec2 ndc = clip.xy / clip.w;
  return vec2(ndc.x * 0.5 + 0.5, 1.0 - (ndc.y * 0.5 + 0.5));
}
`,
    fragment: {
      material: /*glsl*/ `
  vec4 portalFeed = samplePortal(portalScreenUV(vPosition));
  vec4 portalTint = inputTint(material.baseColor, material.displayBaseColor);

  albedo *= decodeFrame(portalFeed.rgb) * portalTint.rgb;
  alpha *= portalTint.a;
`,
    },
  },
};
