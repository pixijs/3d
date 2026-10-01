import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Shader helpers that sample the opaque pass's colour or depth copy at a world position, for custom
 * material bits such as refraction or water
 *
 * {@link Material3D} always includes this bit, so a bit in a Material3D's `extraBits` can call the
 * helpers as they are. Don't add the bit there again: nothing removes duplicate bits, so the
 * helpers would be defined twice and the shader would fail to compile. Other materials add it to
 * their own bit list. The helpers read the camera group, which every material shader binds.
 *
 * - `screenUVFromWorld(worldPos)` projects a world position to a UV in a screen copy. The copies
 *   are pooled textures that can be larger than the view, so the UV is scaled onto the part the
 *   view fills (`uViewportUVScale`) and clamped to it. WGSL flips Y for its top-left texture origin;
 *   GLSL doesn't need to. Use it directly for an offset refraction tap or a depth `textureLoad`.
 * - `sampleScreenCopy(tex, [sampler,] worldPos, lod)` samples a colour copy there at mip `lod`,
 *   pulling the clamp in by half a texel of that mip so a blurred tap stays off the padding. WGSL
 *   takes a sampler; GLSL's `sampler2D` carries its own. Colour only: load depth with
 *   `textureLoad`.
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
