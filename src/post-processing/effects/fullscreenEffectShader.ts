import type { ShaderBit } from '../../core/shader/ShaderBit';
import type { ShaderBitTemplate } from '../../core/shader/ShaderBitTemplate';

/**
 * `fxInputUv` needs each clamp rect inset half a texel, as `RenderGraph._inputClamp` writes it; `linearDepth`
 * needs depth stored as `(ndc + 1) / 2`, which the depth remap in `CameraData.ts` gives WebGPU too
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
fn viewTexel() -> vec2<f32> {
  return fxh.uFxTexel.xy * fxh.uFxTexel.w;
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
vec2 viewTexel() {
  return uFxTexel.xy * uFxTexel.w;
}
vec2 fxInputUv(vec2 uv, vec4 clampRect) {
  return clamp(uv * (clampRect.xy + clampRect.zw), clampRect.xy, clampRect.zw);
}
`,
  },
};

/**
 * `sampleColor` reads level 0 explicitly: `texture()` picks a level from derivatives, undefined in a divergent
 * branch. `sampleColorLod` clamps every level to level 0's rect, since a per-level inset crops coarse levels.
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
vec4 sampleColor(vec2 uv) {
  return textureLod(uTexture, fxInputUv(uv, uFxInputClamp), 0.0);
}
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
 * Clamps with its own rect, since the second input can sit in a different pool bucket from the first
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
 * `DEPTH_HELPER_CALL` in `PostEffect.ts` must name each helper here but `fxDepthContent`. The helpers map
 * through the view's `uViewportUVScale`, not a clamp rect, since the scene depth is allocated at the scene's size.
 * @internal
 */
export const depthReadBitGpu: ShaderBit = {
  name: 'effectDepthRead',
  bindings: {
    fx: {
      uFxDepthTexture: 'texture_depth_2d',
    },
  },
  gpu: {
    header: /* wgsl */ `
fn fxDepthContent() -> vec2<f32> {
  return round(camera.uViewportUVScale * vec2<f32>(textureDimensions(uFxDepthTexture, 0)));
}
fn depthTexel() -> vec2<f32> {
  return 1.0 / fxDepthContent();
}
fn sampleDepth(uv: vec2<f32>) -> f32 {
  let content = fxDepthContent();
  let coord = min(vec2<i32>(clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)) * content), vec2<i32>(content) - 1);
  return textureLoad(uFxDepthTexture, coord, 0);
}
fn viewPos(uv: vec2<f32>) -> vec3<f32> {
  let lz = linearDepth(sampleDepth(uv));
  let ndc = uv * 2.0 - 1.0;
  return vec3<f32>(ndc.x * lz / fxh.uFxClip.z, ndc.y * lz / fxh.uFxClip.w, -lz);
}
`,
  },
};

/**
 * WebGL form of {@link depthReadBitGpu}
 * @internal
 */
export const depthReadBitGl: ShaderBit = {
  name: 'effectDepthRead',
  bindings: {
    fx: {
      uFxDepthTexture: 'texture_2d<f32>',
    },
  },
  gl: {
    header: /* glsl */ `
vec2 fxDepthContent() {
  return round(uViewportUVScale * vec2(textureSize(uFxDepthTexture, 0)));
}
vec2 depthTexel() {
  return 1.0 / fxDepthContent();
}
float sampleDepth(vec2 uv) {
  vec2 content = fxDepthContent();
  ivec2 coord = min(ivec2(clamp(uv, 0.0, 1.0) * content), ivec2(content) - 1);
  return texelFetch(uFxDepthTexture, coord, 0).r;
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
 * `FullscreenPass.render` sets groups by their index in `bindGroups`. `end` code sees `fxColor`, `finalColor` and,
 * in WGSL, `input`, as `toneOutputBits` needs.
 * @internal
 */
export const fullscreenEffectTemplate: ShaderBitTemplate = {
  bindGroups: [{ name: 'global', ubo: true }, 'camera', 'fx', 'fxh'],
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
  let fxColor = effect(input.vUv);
  var finalColor = fxColor.rgb;
  {{fragmentEnd}}
  return vec4<f32>(finalColor, fxColor.a);
}
`,
  gl: {
    vertex: /* glsl */ `#version 300 es

{{header}}

void main() {
  vec2 uv = aPosition * 0.5 + 0.5;
  vUv = vec2(uv.x, mix(uv.y, 1.0 - uv.y, uFxTexel.z));
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`,
    fragment: /* glsl */ `#version 300 es

{{header}}

out vec4 fragColor;

void main() {
  vec4 fxColor = effect(vUv);
  vec3 finalColor = fxColor.rgb;
  {{end}}
  fragColor = vec4(finalColor, fxColor.a);
}
`,
  },
};
