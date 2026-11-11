import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Shader helpers that sample the opaque pass's colour or depth copy at a world position, for custom
 * material bits such as refraction or water
 *
 * List it in your bit's `requires` to get:
 *
 * - `screenUVFromWorld(worldPos)`: the UV of a world position in a screen copy, for an offset
 *   refraction tap or a depth `textureLoad`. A copy can be larger than the view, so the UV is scaled
 *   and clamped to the part the view fills.
 * - `sampleScreenCopy(tex, [sampler,] worldPos, lod)`: samples a colour copy there at mip `lod`,
 *   keeping a blurred tap inside the view's part of the copy. WGSL takes a sampler and GLSL doesn't.
 *   Colour only: load depth with `textureLoad`.
 * @category rendering
 * @advanced
 */
export const screenSpaceFuncsBit: ShaderBit = {
  name: 'screenSpaceFuncs',
  gpu: {
    header: /*wgsl*/ `
fn screenUVFromWorld(worldPos: vec3<f32>) -> vec2<f32> {
  let clip = camera.uViewProjectionMatrix * vec4<f32>(worldPos, 1.0);
  let ndc = clip.xy / clip.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 1.0 - (ndc.y * 0.5 + 0.5)) * camera.uViewportUVScale;
  return clamp(uv, vec2<f32>(0.0), camera.uViewportUVScale);
}

fn sampleScreenCopy(tex: texture_2d<f32>, samp: sampler, worldPos: vec3<f32>, lod: f32) -> vec4<f32> {
  let texDims = vec2<f32>(textureDimensions(tex));
  let inset = min(exp2(lod) * 0.5 / texDims, camera.uViewportUVScale * 0.5);
  let uv = clamp(screenUVFromWorld(worldPos), inset, camera.uViewportUVScale - inset);
  return textureSampleLevel(tex, samp, uv, lod);
}
`,
  },
  gl: {
    header: /*glsl*/ `
vec2 screenUVFromWorld(vec3 worldPos) {
  vec4 clip = uViewProjectionMatrix * vec4(worldPos, 1.0);
  vec2 uv = (clip.xy / clip.w * 0.5 + 0.5) * uViewportUVScale;
  return clamp(uv, vec2(0.0), uViewportUVScale);
}

vec4 sampleScreenCopy(sampler2D tex, vec3 worldPos, float lod) {
  vec2 texDims = vec2(textureSize(tex, 0));
  vec2 inset = min(exp2(lod) * 0.5 / texDims, uViewportUVScale * 0.5);
  vec2 uv = clamp(screenUVFromWorld(worldPos), inset, uViewportUVScale - inset);
  return textureLod(tex, uv, lod);
}
`,
  },
};
