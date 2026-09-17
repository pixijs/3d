import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Screen-space sampling helpers for custom material bits
 *
 * Requires the camera group to be bound — the matrices and `uViewportUVScale` are all its.
 *
 * - `screenUVFromWorld(worldPos)` — projects a world position onto the pooled
 *   copy's content sub-rect: a UV scaled by `uViewportUVScale` and clamped to
 *   `[0, uViewportUVScale]` so it never indexes the power-of-two padding.
 *   Y-flipped for WGSL's top-left texture origin, not for GL's. Use directly when
 *   you need the UV — e.g. an offset refraction tap or a depth `textureLoad`.
 * - `sampleScreenCopy(tex, [sampler,] worldPos, lod)` — colour facade over the
 *   above: tightens the clamp by ~half the mip footprint at `lod` so a blurred
 *   tap stays off the padding, then samples `tex` (dims read from `tex`).
 *   Filtered colour only — depth must be point-loaded (`textureLoad`), not here.
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
  // Top-left sampling origin -> flip Y; scale onto the sub-rect and clamp to it.
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 1.0 - (ndc.y * 0.5 + 0.5)) * camera.uViewportUVScale;
  return clamp(uv, vec2<f32>(0.0), camera.uViewportUVScale);
}

fn sampleScreenCopy(tex: texture_2d<f32>, samp: sampler, worldPos: vec3<f32>, lod: f32) -> vec4<f32> {
  // Tighten the sub-rect clamp by the mip footprint at lod, then sample.
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
  // Bottom-left framebuffer origin (matches gl_FragCoord) -> no Y flip; scale
  // onto the sub-rect and clamp to it.
  vec2 uv = (clip.xy / clip.w * 0.5 + 0.5) * uViewportUVScale;
  return clamp(uv, vec2(0.0), uViewportUVScale);
}

vec4 sampleScreenCopy(sampler2D tex, vec3 worldPos, float lod) {
  // Tighten the sub-rect clamp by the mip footprint at lod, then sample.
  vec2 texDims = vec2(textureSize(tex, 0));
  vec2 inset = min(exp2(lod) * 0.5 / texDims, uViewportUVScale * 0.5);
  vec2 uv = clamp(screenUVFromWorld(worldPos), inset, uViewportUVScale - inset);
  return textureLod(tex, uv, lod);
}
`,
  },
};
