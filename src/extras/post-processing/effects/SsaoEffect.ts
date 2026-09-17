import { definedProps, UniformGroup } from 'pixi.js';

import type { RenderGraph } from '../../../core/render-graph/RenderGraph';
import { FullscreenPass } from '../../../post-processing/effects/FullscreenPass';
import { PostEffect } from '../../../post-processing/effects/PostEffect';
import type { EffectFragment, EffectIO, PostEffectOptions } from '../../../post-processing/effects/PostEffect';

// -- Pass 1: AO compute -----------------------------------------------------
// Reconstructs view position + a robust face normal from depth (4 neighbour
// taps, tangents from the side that doesn't cross a depth edge), samples a
// normal-oriented hemisphere with per-pixel interleaved-gradient-noise
// rotation, and writes raw AO. Depth access, reconstruction, and texel maths
// all come from the std effect header (sampleDepth/viewPos/linearDepth/texel).
// uParams = (radius, bias, intensity, power); uRange = (maxDistance, sampleCount, _, _).

const COMPUTE_FRAGMENT: EffectFragment = {
  gpu: /* wgsl */ `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let d = sampleDepth(uv);
  if (d >= 1.0) { return vec4<f32>(1.0, 1.0, 1.0, 1.0); }

  let P = viewPos(uv);
  let t = texel();
  let pl = viewPos(uv - vec2<f32>(t.x, 0.0));
  let pr = viewPos(uv + vec2<f32>(t.x, 0.0));
  let pd = viewPos(uv - vec2<f32>(0.0, t.y));
  let pu = viewPos(uv + vec2<f32>(0.0, t.y));
  let ddx = select(pr - P, P - pl, abs(pl.z - P.z) < abs(pr.z - P.z));
  let ddy = select(pu - P, P - pd, abs(pd.z - P.z) < abs(pu.z - P.z));
  var N = normalize(cross(ddx, ddy));
  if (dot(N, -P) < 0.0) { N = -N; }

  // Per-pixel kernel rotation (interleaved gradient noise) so the blur has
  // high-frequency noise to dissolve rather than fixed banding.
  let fc = uv / t;
  let ign = fract(52.9829189 * fract(dot(fc, vec2<f32>(0.06711056, 0.00583715))));
  let rc = cos(ign * 6.2831853);
  let rs = sin(ign * 6.2831853);

  var up = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(N.y) > 0.95) { up = vec3<f32>(1.0, 0.0, 0.0); }
  let tangent = normalize(cross(up, N));
  let bitangent = cross(N, tangent);

  let radius = fx.uParams.x;
  let bias = fx.uParams.y;
  let count = i32(fx.uRange.y);
  var occ = 0.0;
  for (var i = 0; i < count; i = i + 1) {
    let fi = f32(i);
    let ang = fi * 2.3999632;
    let r = sqrt((fi + 0.5) / fx.uRange.y);
    let cx = cos(ang) * r;
    let cy = sin(ang) * r;
    let dir = tangent * (cx * rc - cy * rs) + bitangent * (cx * rs + cy * rc) + N * sqrt(max(1.0 - r * r, 0.0));
    let samplePos = P + dir * (radius * (0.2 + 0.8 * fi / fx.uRange.y));

    let sUv = vec2<f32>(samplePos.x * fxh.uFxClip.z, samplePos.y * fxh.uFxClip.w) / (-samplePos.z) * 0.5 + 0.5;
    let sceneZ = -linearDepth(sampleDepth(sUv));
    // Range cutoff decoupled from radius: wide sample radius (smooth AO)
    // without silhouette halos from distant occluders.
    let rangeCheck = 1.0 - smoothstep(0.0, fx.uRange.x, abs(P.z - sceneZ));
    occ += select(0.0, rangeCheck, sceneZ >= samplePos.z + bias);
  }
  occ = occ / fx.uRange.y;

  let ao = clamp(1.0 - occ * fx.uParams.z, 0.0, 1.0);
  let v = pow(ao, fx.uParams.w);
  return vec4<f32>(v, v, v, 1.0);
}
`,
  gl: /* glsl */ `
vec4 effect(vec2 uv) {
  float d = sampleDepth(uv);
  if (d >= 1.0) { return vec4(1.0); }

  vec3 P = viewPos(uv);
  vec2 t = texel();
  vec3 pl = viewPos(uv - vec2(t.x, 0.0));
  vec3 pr = viewPos(uv + vec2(t.x, 0.0));
  vec3 pd = viewPos(uv - vec2(0.0, t.y));
  vec3 pu = viewPos(uv + vec2(0.0, t.y));
  vec3 ddx = abs(pl.z - P.z) < abs(pr.z - P.z) ? (P - pl) : (pr - P);
  vec3 ddy = abs(pd.z - P.z) < abs(pu.z - P.z) ? (P - pd) : (pu - P);
  vec3 N = normalize(cross(ddx, ddy));
  if (dot(N, -P) < 0.0) { N = -N; }

  vec2 fc = uv / t;
  float ign = fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
  float rc = cos(ign * 6.2831853);
  float rs = sin(ign * 6.2831853);

  vec3 up = abs(N.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 tangent = normalize(cross(up, N));
  vec3 bitangent = cross(N, tangent);

  float radius = uParams.x;
  float bias = uParams.y;
  float occ = 0.0;
  for (int i = 0; i < int(uRange.y); i++) {
    float fi = float(i);
    float ang = fi * 2.3999632;
    float r = sqrt((fi + 0.5) / uRange.y);
    float cx = cos(ang) * r;
    float cy = sin(ang) * r;
    vec3 dir = tangent * (cx * rc - cy * rs) + bitangent * (cx * rs + cy * rc) + N * sqrt(max(1.0 - r * r, 0.0));
    vec3 samplePos = P + dir * (radius * (0.2 + 0.8 * fi / uRange.y));

    vec2 sUv = vec2(samplePos.x * uFxClip.z, samplePos.y * uFxClip.w) / (-samplePos.z) * 0.5 + 0.5;
    float sceneZ = -linearDepth(sampleDepth(sUv));
    float rangeCheck = 1.0 - smoothstep(0.0, uRange.x, abs(P.z - sceneZ));
    occ += sceneZ >= samplePos.z + bias ? rangeCheck : 0.0;
  }
  occ /= uRange.y;

  float ao = clamp(1.0 - occ * uParams.z, 0.0, 1.0);
  float v = pow(ao, uParams.w);
  return vec4(v, v, v, 1.0);
}
`,
};

// -- Pass 2: box blur ---------------------------------------------------------
// 5×5 box over the raw AO — dissolves the per-sample noise into the smooth
// "proper AO" look. uBlur = (step in texels, _, _, _).

const BLUR_FRAGMENT: EffectFragment = {
  gpu: /* wgsl */ `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  var sum = 0.0;
  for (var j = -2; j <= 2; j = j + 1) {
    for (var i = -2; i <= 2; i = i + 1) {
      let o = vec2<f32>(f32(i), f32(j)) * texel() * fx.uBlur.x;
      sum += sampleColor(uv + o).r;
    }
  }
  let ao = sum / 25.0;
  return vec4<f32>(ao, ao, ao, 1.0);
}
`,
  gl: /* glsl */ `
vec4 effect(vec2 uv) {
  float sum = 0.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 o = vec2(float(i), float(j)) * texel() * uBlur.x;
      sum += sampleColor(uv + o).r;
    }
  }
  float ao = sum / 25.0;
  return vec4(ao, ao, ao, 1.0);
}
`,
};

// -- Pass 3: merge -----------------------------------------------------------
// Multiply the blurred AO onto the chain image. RGB-only so occlusion darkens
// light, not coverage — correct on alpha-composited inset edges.

const MERGE_FRAGMENT: EffectFragment = {
  gpu: /* wgsl */ `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let base = sampleColor(uv);
  return vec4<f32>(base.rgb * sampleColor2(uv).rgb, base.a);
}
`,
  gl: /* glsl */ `
vec4 effect(vec2 uv) {
  vec4 base = sampleColor(uv);
  return vec4(base.rgb * sampleColor2(uv).rgb, base.a);
}
`,
};

/**
 * Constructor options for {@link SsaoEffect}
 * @category extras:post-processing
 * @standard
 */
export interface SsaoEffectOptions extends PostEffectOptions {
  /**
   * Hemisphere sampling radius in world units — how wide the AO reaches
   * @default 0.35
   */
  radius?: number;
  /**
   * Maximum depth distance an occluder may be to count — the halo cutoff
   *
   * Decoupled from `radius`.
   * @default radius * 0.65
   */
  maxDistance?: number;
  /**
   * Strength of the darkening
   * @default 0.9
   */
  intensity?: number;
  /**
   * Self-occlusion bias in world units
   * @default 0.025
   */
  bias?: number;
  /**
   * Contrast curve on the AO term
   * @default 1.5
   */
  power?: number;
  /**
   * Hemisphere samples per pixel
   * @default 16
   */
  samples?: number;
  /**
   * Blur kernel step in texels
   * @default 1.5
   */
  blurStep?: number;
  /**
   * AO buffer resolution in device pixels per logical pixel — pixi's meaning, as on filters
   *
   * `'inherit'` matches the view; `1` is one texel per logical pixel, the usual choice on
   * high-DPI screens where full-resolution AO is the cost that hurts.
   * @default 'inherit'
   */
  resolution?: number | 'inherit';
}

/**
 * Screen-space ambient occlusion
 *
 * Three passes: hemisphere AO from the scene depth (grabbed straight off the graph), a box
 * blur, and a multiply merge onto the chain image. Every property is a live uniform write.
 * @example
 * ```ts
 * view.passes = [new SsaoEffect({ radius: 0.35, resolution: 1 })];
 * ```
 * @category extras:post-processing
 * @standard
 */
export class SsaoEffect extends PostEffect {
  /**
   * Default {@link SsaoEffectOptions} merged under every constructor call
   *
   * `new SsaoEffect(opts)` resolves as `{ ...SsaoEffect.defaultOptions, ...opts }`. Mutate to change defaults
   * process-wide. `maxDistance` has no entry: when neither side sets it, it follows the resolved `radius`.
   * @example
   * ```ts
   * SsaoEffect.defaultOptions.resolution = 1;
   * ```
   */
  public static defaultOptions: SsaoEffectOptions = {
    radius: 0.35,
    intensity: 0.9,
    bias: 0.025,
    power: 1.5,
    samples: 16,
    blurStep: 1.5,
    resolution: 'inherit',
  };

  private readonly _computeUniforms = new UniformGroup({
    uParams: { value: new Float32Array(4), type: 'vec4<f32>' },
    uRange: { value: new Float32Array(4), type: 'vec4<f32>' },
  });

  private readonly _blurUniforms = new UniformGroup({
    uBlur: { value: new Float32Array(4), type: 'vec4<f32>' },
  });

  private readonly _resolution: number | 'inherit';

  constructor(options: SsaoEffectOptions = {}) {
    const { radius, maxDistance, intensity, bias, power, samples, blurStep, resolution, ...rest } = {
      ...SsaoEffect.defaultOptions,
      ...definedProps(options),
    };

    super(rest);
    this._resolution = resolution!;

    this.radius = radius!;
    this.maxDistance = maxDistance ?? radius! * 0.65;
    this.intensity = intensity!;
    this.bias = bias!;
    this.power = power!;
    this.samples = samples!;
    this.blurStep = blurStep!;
  }

  /**
   * Add the AO, blur and merge passes for this slot in the chain
   * @param graph - Render graph being built.
   * @param io - Input/output handles for this slot in the chain.
   */
  public override build(graph: RenderGraph, io: EffectIO): void {
    const ao = graph.createColor({ resolution: this._resolution, format: 'rgba8unorm', label: 'ssaoAO' });
    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'ssao:compute',
        fragment: COMPUTE_FRAGMENT,
        uniforms: this._computeUniforms,
        reads: { depth: graph.sceneDepth },
        writes: ao,
      }),
    );

    const blurred = graph.createColor({ resolution: this._resolution, format: 'rgba8unorm', label: 'ssaoBlur' });
    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'ssao:blur',
        fragment: BLUR_FRAGMENT,
        uniforms: this._blurUniforms,
        reads: { color: ao },
        writes: blurred,
      }),
    );

    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'ssao:merge',
        fragment: MERGE_FRAGMENT,
        reads: { color: io.input, color2: blurred },
        writes: io.output,
      }),
    );
  }

  // --- Live params: plain lane writes, visible next frame ---

  /** Hemisphere sampling radius in world units */
  public get radius(): number {
    return (this._computeUniforms.uniforms.uParams as Float32Array)[0];
  }
  /**
   * Sets the hemisphere sampling radius
   * @param value - Radius in world units.
   */
  public set radius(value: number) {
    this.writeLane(this._computeUniforms, 'uParams', 0, value);
  }

  /** Self-occlusion bias in world units */
  public get bias(): number {
    return (this._computeUniforms.uniforms.uParams as Float32Array)[1];
  }
  /**
   * Sets the self-occlusion bias
   * @param value - Depth offset in world units that stops a surface occluding itself.
   */
  public set bias(value: number) {
    this.writeLane(this._computeUniforms, 'uParams', 1, value);
  }

  /** Strength of the darkening */
  public get intensity(): number {
    return (this._computeUniforms.uniforms.uParams as Float32Array)[2];
  }
  /**
   * Sets the darkening strength
   * @param value - Multiplier on the occlusion; 0 turns the darkening off.
   */
  public set intensity(value: number) {
    this.writeLane(this._computeUniforms, 'uParams', 2, value);
  }

  /** Contrast curve on the AO term */
  public get power(): number {
    return (this._computeUniforms.uniforms.uParams as Float32Array)[3];
  }
  /**
   * Sets the contrast curve on the AO term
   * @param value - Exponent applied to the AO term; higher values darken the occluded areas further.
   */
  public set power(value: number) {
    this.writeLane(this._computeUniforms, 'uParams', 3, value);
  }

  /** Maximum occluder depth distance — the halo cutoff */
  public get maxDistance(): number {
    return (this._computeUniforms.uniforms.uRange as Float32Array)[0];
  }
  /**
   * Sets the maximum occluder depth distance
   * @param value - Depth gap in world units at which an occluder's contribution fades to zero.
   */
  public set maxDistance(value: number) {
    this.writeLane(this._computeUniforms, 'uRange', 0, value);
  }

  /** Hemisphere samples per pixel */
  public get samples(): number {
    return (this._computeUniforms.uniforms.uRange as Float32Array)[1];
  }
  /**
   * Sets the hemisphere sample count per pixel
   * @param value - Samples per pixel; the cost of the AO pass grows with it.
   */
  public set samples(value: number) {
    this.writeLane(this._computeUniforms, 'uRange', 1, value);
  }

  /** Blur kernel step in texels */
  public get blurStep(): number {
    return (this._blurUniforms.uniforms.uBlur as Float32Array)[0];
  }
  /**
   * Sets the blur kernel step
   * @param value - Spacing between blur taps, in texels.
   */
  public set blurStep(value: number) {
    this.writeLane(this._blurUniforms, 'uBlur', 0, value);
  }
}
