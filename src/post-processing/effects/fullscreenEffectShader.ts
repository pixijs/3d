import type { ShaderBit } from '../../core/shader/ShaderBit';
import type { ShaderBitTemplate } from '../../core/shader/ShaderBitTemplate';

/**
 * The standard effect header, split into composable bits
 *
 * Every fullscreen effect pass compiles `[fxhBit, ...read bits, fragment bit]` through
 * {@link fullscreenEffectTemplate}. The contract effect bodies write against (content-space
 * UV, the sample helpers, uniform naming) is documented on `EffectFragment`.
 *
 * Header data (`fxh` group, pass-owned, auto-fed per frame):
 *
 *  - `uFxClip`  = (camera.near, camera.far, proj[0], proj[5])
 *  - `uFxTexel` = (1/vpWidth, 1/vpHeight, flipY, 0), flipY set by the pass
 *    (WebGPU presenting to screen flips once; transient↔transient stays straight)
 *  - `uFxInputClamp` / `uFxInput2Clamp` = `(min.x, min.y, max.x, max.y)`, one per colour input:
 *    the bounds a tap on that input may reach, in its own texture's UV, inset half a texel from
 *    the content's edge. Pixi's filters carry the same rect as `uInputClamp`, for the same
 *    reason — a filter's input is also a pooled texture larger than its content.
 *
 *    The content sub-rect falls out of it rather than being stored twice: `min` is half a texel
 *    and `max` is the far edge less half a texel, so `min + max` is the content's extent in the
 *    texture exactly. `fxInputUv` below does both jobs in one expression, which is why a tap
 *    past the content edge replicates that edge instead of reading the pool's previous tenant.
 *
 *    Per input, not per view: a transient created at a `resolution` other than the view's rounds
 *    into a different pool bucket, so one shared rect cannot serve both.
 * @internal
 */
export const fxhBit: ShaderBit = {
  name: 'effectFxh',
  attributes: {
    aPosition: 'float32x2',
  },
  interStage: {
    vUv: 'vec2<f32>',
  },
  bindings: {
    fxh: {
      uFxClip: 'vec4<f32>',
      uFxTexel: 'vec4<f32>',
      uFxInputClamp: 'vec4<f32>',
      uFxInput2Clamp: 'vec4<f32>',
    },
  },
  // linearDepth inverts the stored depth `(ndc + 1) / 2` of a GL-convention perspective
  // projection. Both backends store that: GL by its fixed-function range, WebGPU because the
  // camera data remaps the bound projection's clip z to [0, w] (`CameraData.set`).
  gpu: {
    header: /* wgsl */ `
fn linearDepth(d: f32) -> f32 {
  let n = fxh.uFxClip.x;
  let f = fxh.uFxClip.y;
  let z = d * 2.0 - 1.0;
  return 2.0 * n * f / (f + n - z * (f - n));
}
fn texel() -> vec2<f32> {
  return fxh.uFxTexel.xy;
}
fn fxInputUv(uv: vec2<f32>, clampRect: vec4<f32>) -> vec2<f32> {
  return clamp(uv * (clampRect.xy + clampRect.zw), clampRect.xy, clampRect.zw);
}
`,
  },
  gl: {
    header: /* glsl */ `
float linearDepth(float d) {
  float n = uFxClip.x;
  float f = uFxClip.y;
  float z = d * 2.0 - 1.0;
  return 2.0 * n * f / (f + n - z * (f - n));
}
vec2 texel() {
  return uFxTexel.xy;
}
vec2 fxInputUv(vec2 uv, vec4 clampRect) {
  return clamp(uv * (clampRect.xy + clampRect.zw), clampRect.xy, clampRect.zw);
}
`,
  },
};

/**
 * Chain-colour input — `sampleColor(contentUv)`, `sampleColorLod(contentUv, lod)` and
 * `inputTexel()`
 *
 * The LOD form addresses the mip chain when the bound handle is mip-chained (blur/bokeh
 * effects); on a single-level texture it clamps to 0. `inputTexel()` is one texel of the input
 * as a content-UV step, for kernels whose footprint must follow the input rather than the
 * target (`texel()` is the target's); the clamp rect's `min + max` is the content's extent in
 * the texture, so texture size × extent is the content's size in texels.
 * @internal
 */
export const colorReadBit: ShaderBit = {
  name: 'effectColorRead',
  bindings: {
    fx: {
      uTexture: 'texture_2d<f32>',
      uTextureSampler: 'sampler',
    },
  },
  gpu: {
    header: /* wgsl */ `
fn sampleColor(uv: vec2<f32>) -> vec4<f32> {
  return textureSampleLevel(uTexture, uTextureSampler, fxInputUv(uv, fxh.uFxInputClamp), 0.0);
}
// Level 0's bounds, at every level. Insetting by the level's own half-texel would be the exact
// clamp, but on a coarse level that is a quarter of the content wide and it crops the image
// rather than guarding its edge. Coarse levels averaged the padding in when the chain was
// generated anyway, so there is nothing left for a clamp to protect; that is a mip-chained
// transient's own problem.
fn sampleColorLod(uv: vec2<f32>, lod: f32) -> vec4<f32> {
  return textureSampleLevel(uTexture, uTextureSampler, fxInputUv(uv, fxh.uFxInputClamp), lod);
}
fn inputTexel() -> vec2<f32> {
  return 1.0 / (vec2<f32>(textureDimensions(uTexture, 0)) * (fxh.uFxInputClamp.xy + fxh.uFxInputClamp.zw));
}
`,
  },
  gl: {
    header: /* glsl */ `
// Explicit level 0, matching the WGSL read. texture() picks its level from quad derivatives,
// which are undefined inside a branch not every pixel takes, so a mip-chained input would read
// a coarse level along the branch's edge.
vec4 sampleColor(vec2 uv) {
  return textureLod(uTexture, fxInputUv(uv, uFxInputClamp), 0.0);
}
// See the WGSL note: level 0's bounds at every level, because insetting per level crops coarse
// ones, and their padding is already baked in by mip generation.
vec4 sampleColorLod(vec2 uv, float lod) {
  return textureLod(uTexture, fxInputUv(uv, uFxInputClamp), lod);
}
vec2 inputTexel() {
  return 1.0 / (vec2(textureSize(uTexture, 0)) * (uFxInputClamp.xy + uFxInputClamp.zw));
}
`,
  },
};

/**
 * Second colour input for combine composites — `sampleColor2(contentUv)`
 * @internal
 */
export const color2ReadBit: ShaderBit = {
  name: 'effectColor2Read',
  bindings: {
    fx: {
      uTexture2: 'texture_2d<f32>',
      uTexture2Sampler: 'sampler',
    },
  },
  gpu: {
    header: /* wgsl */ `
fn sampleColor2(uv: vec2<f32>) -> vec4<f32> {
  return textureSampleLevel(uTexture2, uTexture2Sampler, fxInputUv(uv, fxh.uFxInput2Clamp), 0.0);
}
`,
  },
  gl: {
    header: /* glsl */ `
vec4 sampleColor2(vec2 uv) {
  return textureLod(uTexture2, fxInputUv(uv, uFxInput2Clamp), 0.0);
}
`,
  },
};

/**
 * Scene-depth input — `sampleDepth(contentUv)` and `viewPos(contentUv)`
 *
 * `sampleDepth` is raw non-linear depth; `viewPos` reconstructs the view-space position via
 * the header's clip data, the standard input for AO/SSR-style effects.
 * @internal
 */
export const depthReadBit: ShaderBit = {
  name: 'effectDepthRead',
  // Mapped by the view's `uViewportUVScale`, not by a per-input clamp rect: the opaque depth
  // copy is always allocated at the viewport, so the view's scale is its scale.
  //
  // Header-only (no bindings): samples the GLOBAL group's opaque-depth copy —
  // `uOpaqueDepthTexture`, declared per backend by the global bits and bound
  // by the graph when the pass declares `b.sample(depth,
  // pipe.globalSlots.opaqueDepth)`. Backend depth-texture types and the
  // WebGPU depth-aspect view stay the engine's problem. WGSL fetches with
  // textureLoad (depth textures pair only with non-filtering samplers, and
  // depth wants nearest anyway); GL's sampler2D reads depth in `.r`.
  gpu: {
    header: /* wgsl */ `
fn sampleDepth(uv: vec2<f32>) -> f32 {
  let dims = vec2<f32>(textureDimensions(uOpaqueDepthTexture, 0));
  let texUv = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)) * camera.uViewportUVScale;
  let coord = vec2<i32>(texUv * (dims - 1.0) + 0.5);
  return textureLoad(uOpaqueDepthTexture, coord, 0);
}
fn viewPos(uv: vec2<f32>) -> vec3<f32> {
  let lz = linearDepth(sampleDepth(uv));
  let ndc = uv * 2.0 - 1.0;
  return vec3<f32>(ndc.x * lz / fxh.uFxClip.z, ndc.y * lz / fxh.uFxClip.w, -lz);
}
`,
  },
  gl: {
    header: /* glsl */ `
float sampleDepth(vec2 uv) {
  return texture(uOpaqueDepthTexture, clamp(uv, 0.0, 1.0) * uViewportUVScale).r;
}
vec3 viewPos(vec2 uv) {
  float lz = linearDepth(sampleDepth(uv));
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc.x * lz / uFxClip.z, ndc.y * lz / uFxClip.w, -lz);
}
`,
  },
};

/**
 * Fullscreen-triangle template for effect passes
 *
 * The second entry-point compiler beside the material template. The fragment stage delegates
 * to the pass fragment's `effect(uv)`.
 *
 * `vUv` is CONTENT-space (see the header contract): flip is data, not code —
 * `uFxTexel.z` is 1 only when a WebGPU pass presents to the screen, so
 * transient↔transient hops stay straight and orientation never double-flips
 * through a chain.
 * @internal
 */
export const fullscreenEffectTemplate: ShaderBitTemplate = {
  bindGroups: ['global', 'camera', 'fx', 'fxh'],
  gpu: /* wgsl */ `
{{header}}

@vertex
fn mainVertex(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4<f32>(input.aPosition, 0.0, 1.0);
  let uv = input.aPosition * 0.5 + 0.5;
  output.vUv = vec2<f32>(uv.x, mix(uv.y, 1.0 - uv.y, fxh.uFxTexel.z));
  return output;
}

@fragment
fn mainFragment(input: FragmentInput) -> @location(0) vec4<f32> {
  return effect(input.vUv);
}
`,
  gl: {
    vertex: /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
precision highp samplerCube;
precision highp sampler2DArrayShadow;

{{header}}

void main() {
  vec2 uv = aPosition * 0.5 + 0.5;
  vUv = vec2(uv.x, mix(uv.y, 1.0 - uv.y, uFxTexel.z));
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`,
    fragment: /* glsl */ `#version 300 es
precision highp float;
precision highp samplerCube;
precision highp sampler2D;
precision highp sampler2DArrayShadow;

{{header}}

out vec4 fragColor;

void main() {
  fragColor = effect(vUv);
}
`,
  },
};
