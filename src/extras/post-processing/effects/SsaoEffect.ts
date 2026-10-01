import { definedProps, UniformGroup } from 'pixi.js';

import type { RenderGraph } from '../../../core/render-graph/RenderGraph';
import { FullscreenPass } from '../../../post-processing/effects/FullscreenPass';
import { PostEffect } from '../../../post-processing/effects/PostEffect';
import type { EffectFragment, EffectIO, PostEffectOptions } from '../../../post-processing/effects/PostEffect';

/**
 * First pass: raw ambient occlusion from the scene depth
 *
 * Rebuilds the view-space position and a face normal from depth. Of the four neighbour taps it
 * takes each tangent from the side whose depth is nearer the centre's, so the normal holds at a
 * depth edge. Samples lie on a golden-angle spiral (2.3999632 radians apart) over a hemisphere
 * around the normal, and interleaved gradient noise rotates the spiral per pixel, so the blur
 * pass has high-frequency noise to dissolve rather than fixed banding.
 *
 * An occluder counts in full when its depth is close to the shaded point's and fades out by
 * `maxDistance`. That cutoff is separate from `radius`, so a wide radius gives smooth occlusion
 * without halos from distant occluders around silhouettes.
 *
 * Reads `uParams` = (radius, bias, intensity, power) and `uRange` = (maxDistance, samples, unused,
 * unused).
 */
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

/**
 * Second pass: a 5×5 box blur over the raw occlusion, which dissolves the per-pixel noise
 *
 * Reads `uBlur` = (step in texels, unused, unused, unused).
 */
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

/**
 * Last pass: multiplies the blurred occlusion onto the chain image
 *
 * Only RGB is multiplied, so occlusion darkens light but not coverage, and the edges of a view
 * composited over 2D content keep their alpha.
 */
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
 * @example
 * ```ts
 * const options: SsaoEffectOptions = { radius: 0.5, intensity: 1.2, resolution: 1 };
 * view3d.passes = [new SsaoEffect(options)];
 * ```
 * @category extras:post-processing
 * @standard
 */
export interface SsaoEffectOptions extends PostEffectOptions {
  /**
   * How far around each point the effect looks for occluders, in world units
   * @default 0.35
   * @example
   * ```ts
   * new SsaoEffect({ radius: 1 });
   * ```
   */
  radius?: number;
  /**
   * Depth gap in world units at which an occluder stops counting
   *
   * An occluder's contribution fades from full at no gap to nothing at this one, which stops dark
   * halos where a near object overlaps a distant one. Set apart from `radius` so a wide radius
   * doesn't widen the halos too.
   * @default radius * 0.65
   * @example
   * ```ts
   * new SsaoEffect({ radius: 1, maxDistance: 0.3 });
   * ```
   */
  maxDistance?: number;
  /**
   * Strength of the darkening
   * @default 0.9
   * @example
   * ```ts
   * new SsaoEffect({ intensity: 1.5 });
   * ```
   */
  intensity?: number;
  /**
   * Depth offset in world units that stops a surface occluding itself
   *
   * Raise it if flat surfaces show speckled shading; lower it if contact shadows vanish.
   * @default 0.025
   * @example
   * ```ts
   * new SsaoEffect({ bias: 0.05 });
   * ```
   */
  bias?: number;
  /**
   * Exponent on the occlusion term; higher values darken the occluded areas further
   * @default 1.5
   * @example
   * ```ts
   * new SsaoEffect({ power: 2 });
   * ```
   */
  power?: number;
  /**
   * Samples per pixel; the cost of the occlusion pass grows with it
   * @default 16
   * @example
   * ```ts
   * new SsaoEffect({ samples: 8 });
   * ```
   */
  samples?: number;
  /**
   * Spacing between blur taps, in texels of the occlusion buffer
   * @default 1.5
   * @example
   * ```ts
   * new SsaoEffect({ blurStep: 2 });
   * ```
   */
  blurStep?: number;
  /**
   * Texels per logical pixel for the occlusion buffers, as `resolution` means on a pixi filter
   *
   * `'inherit'` matches the view. On a high-DPI screen `1` is the usual choice: one texel per
   * logical pixel, a quarter of the work at a device pixel ratio of 2. Fixed at construction.
   * @default 'inherit'
   * @example
   * ```ts
   * new SsaoEffect({ resolution: 1 });
   * ```
   */
  resolution?: number | 'inherit';
}

/**
 * Screen-space ambient occlusion: darkens creases, corners and contact points
 *
 * Three passes: occlusion from the scene depth, a blur, and a multiply onto the frame. The first
 * two draw at `resolution`. Every property is a plain uniform write, so it can change every frame;
 * `resolution` is fixed at construction.
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
   * Add the occlusion, blur and merge passes for this slot in the chain
   * @param graph - Render graph being built.
   * @param io - Input/output handles for this slot in the chain.
   * @example
   * ```ts
   * const occluded = graph.createColor({ label: 'occluded' });
   * ssao.build(graph, { ...io, output: occluded });
   * ```
   * @advanced
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

  /**
   * How far around each point the effect looks for occluders, in world units
   * @example
   * ```ts
   * ssao.radius = 0.6;
   * ```
   */
  public get radius(): number {
    return (this._computeUniforms.uniforms.uParams as Float32Array)[0];
  }
  /**
   * Sets how far around each point the effect looks for occluders
   * @param value - Radius in world units.
   */
  public set radius(value: number) {
    this.writeLane(this._computeUniforms, 'uParams', 0, value);
  }

  /**
   * Depth offset in world units that stops a surface occluding itself
   * @example
   * ```ts
   * ssao.bias = 0.05;
   * ```
   */
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

  /**
   * Strength of the darkening
   *
   * `0` hides the darkening, but every pass still runs; set `enabled` to `false` to skip them.
   * @example
   * ```ts
   * ssao.intensity = 0.5;
   * ```
   */
  public get intensity(): number {
    return (this._computeUniforms.uniforms.uParams as Float32Array)[2];
  }
  /**
   * Sets the darkening strength
   * @param value - Multiplier on the occlusion.
   */
  public set intensity(value: number) {
    this.writeLane(this._computeUniforms, 'uParams', 2, value);
  }

  /**
   * Exponent on the occlusion term; higher values darken the occluded areas further
   * @example
   * ```ts
   * ssao.power = 2;
   * ```
   */
  public get power(): number {
    return (this._computeUniforms.uniforms.uParams as Float32Array)[3];
  }
  /**
   * Sets the exponent on the occlusion term
   * @param value - Exponent applied to the occlusion term.
   */
  public set power(value: number) {
    this.writeLane(this._computeUniforms, 'uParams', 3, value);
  }

  /**
   * Depth gap in world units at which an occluder stops counting; {@link SsaoEffectOptions#maxDistance} has the details
   * @example
   * ```ts
   * ssao.maxDistance = ssao.radius * 0.5;
   * ```
   */
  public get maxDistance(): number {
    return (this._computeUniforms.uniforms.uRange as Float32Array)[0];
  }
  /**
   * Sets the depth gap at which an occluder stops counting
   * @param value - Depth gap in world units at which an occluder's contribution fades to zero.
   */
  public set maxDistance(value: number) {
    this.writeLane(this._computeUniforms, 'uRange', 0, value);
  }

  /**
   * Samples per pixel; the cost of the occlusion pass grows with it
   * @example
   * ```ts
   * ssao.samples = isMobile ? 8 : 16;
   * ```
   */
  public get samples(): number {
    return (this._computeUniforms.uniforms.uRange as Float32Array)[1];
  }
  /**
   * Sets the samples per pixel
   * @param value - Samples per pixel.
   */
  public set samples(value: number) {
    this.writeLane(this._computeUniforms, 'uRange', 1, value);
  }

  /**
   * Spacing between blur taps, in texels of the occlusion buffer
   * @example
   * ```ts
   * ssao.blurStep = 2;
   * ```
   */
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
