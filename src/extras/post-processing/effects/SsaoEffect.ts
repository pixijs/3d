import { definedProps, UniformGroup } from 'pixi.js';

import type { RenderGraph } from '../../../core/render-graph/RenderGraph';
import type { SceneOutput } from '../../../core/render-graph/SceneOutput';
import { FullscreenPass } from '../../../post-processing/effects/FullscreenPass';
import { PostEffect } from '../../../post-processing/effects/PostEffect';
import type { EffectFragment, EffectIO, PostEffectOptions } from '../../../post-processing/effects/PostEffect';
import { normalOutput } from '../../scene-outputs/normalOutput';

/** Taps at least one depth texel out, so none lands on the centre's texel when the occlusion buffer is finer */
const DEPTH_NORMAL = {
  gpu: /* wgsl */ `
  let dt = max(t, depthTexel());
  let pl = viewPos(uv - vec2<f32>(dt.x, 0.0));
  let pr = viewPos(uv + vec2<f32>(dt.x, 0.0));
  let pd = viewPos(uv - vec2<f32>(0.0, dt.y));
  let pu = viewPos(uv + vec2<f32>(0.0, dt.y));
  let ddx = select(pr - P, P - pl, abs(pl.z - P.z) < abs(pr.z - P.z));
  let ddy = select(pu - P, P - pd, abs(pd.z - P.z) < abs(pu.z - P.z));
  var N = normalize(cross(ddx, ddy));`,
  gl: /* glsl */ `
  vec2 dt = max(t, depthTexel());
  vec3 pl = viewPos(uv - vec2(dt.x, 0.0));
  vec3 pr = viewPos(uv + vec2(dt.x, 0.0));
  vec3 pd = viewPos(uv - vec2(0.0, dt.y));
  vec3 pu = viewPos(uv + vec2(0.0, dt.y));
  vec3 ddx = abs(pl.z - P.z) < abs(pr.z - P.z) ? (P - pl) : (pr - P);
  vec3 ddy = abs(pd.z - P.z) < abs(pu.z - P.z) ? (P - pd) : (pu - P);
  vec3 N = normalize(cross(ddx, ddy));`,
};

const SCENE_NORMAL = {
  gpu: /* wgsl */ `
  var N = normalize(sampleColor(uv).xyz * 2.0 - 1.0);`,
  gl: /* glsl */ `
  vec3 N = normalize(sampleColor(uv).xyz * 2.0 - 1.0);`,
};

/**
 * Writes occlusion to red and log view depth to green + blue / 255, the sum {@link blurFragment} decodes
 * @param normal - Code that declares `N`, the view-space normal at `P`; it can read `t`, the texel size.
 */
function computeFragment(normal: { gpu: string; gl: string }): EffectFragment {
  return {
    gpu: /* wgsl */ `
fn packDepth(ao: f32, z: f32) -> vec4<f32> {
  let v = clamp(log(z / fxh.uFxClip.x) / log(fxh.uFxClip.y / fxh.uFxClip.x), 0.0, 1.0) * 255.0;
  return vec4<f32>(ao, floor(v) / 255.0, fract(v), 1.0);
}
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let d = sampleDepth(uv);
  if (d >= 1.0) { return vec4<f32>(1.0, 1.0, 0.0, 1.0); }

  let P = viewPos(uv);
  let fade = select(1.0, 1.0 - smoothstep(fx.uRange.z, fx.uRange.w, -P.z), fx.uRange.w > 0.0);
  if (fade <= 0.0) { return packDepth(1.0, -P.z); }
  let t = texel();
${normal.gpu}
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

  let ao = clamp(1.0 - occ * fx.uParams.z * fade, 0.0, 1.0);
  return packDepth(pow(ao, fx.uParams.w), -P.z);
}
`,
    gl: /* glsl */ `
vec4 packDepth(float ao, float z) {
  float v = clamp(log(z / uFxClip.x) / log(uFxClip.y / uFxClip.x), 0.0, 1.0) * 255.0;
  return vec4(ao, floor(v) / 255.0, fract(v), 1.0);
}
vec4 effect(vec2 uv) {
  float d = sampleDepth(uv);
  if (d >= 1.0) { return vec4(1.0, 1.0, 0.0, 1.0); }

  vec3 P = viewPos(uv);
  float fade = uRange.w > 0.0 ? 1.0 - smoothstep(uRange.z, uRange.w, -P.z) : 1.0;
  if (fade <= 0.0) { return packDepth(1.0, -P.z); }
  vec2 t = texel();
${normal.gl}
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

  float ao = clamp(1.0 - occ * uParams.z * fade, 0.0, 1.0);
  return packDepth(pow(ao, uParams.w), -P.z);
}
`,
  };
}

const DEPTH_NORMAL_FRAGMENT = computeFragment(DEPTH_NORMAL);

const SCENE_NORMAL_FRAGMENT = computeFragment(SCENE_NORMAL);

/** Passes green and blue through, so the second blur can still decode the depth {@link computeFragment} packs */
function blurFragment(axis: 'x' | 'y'): EffectFragment {
  const dir = axis === 'x' ? '1.0, 0.0' : '0.0, 1.0';

  return {
    gpu: /* wgsl */ `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let c = sampleColor(uv);
  let zc = c.g + c.b / 255.0;
  let sharpness = 10.0 * log(fxh.uFxClip.y / fxh.uFxClip.x);
  let stride = vec2<f32>(${dir}) * texel() * fx.uBlur.x;
  var sum = c.r;
  var weight = 1.0;
  for (var i = -2; i <= 2; i = i + 1) {
    if (i == 0) { continue; }
    let s = sampleColor(uv + stride * f32(i));
    let w = max(1.0 - abs(s.g + s.b / 255.0 - zc) * sharpness, 0.0);
    sum += s.r * w;
    weight += w;
  }
  return vec4<f32>(sum / weight, c.g, c.b, 1.0);
}
`,
    gl: /* glsl */ `
vec4 effect(vec2 uv) {
  vec4 c = sampleColor(uv);
  float zc = c.g + c.b / 255.0;
  float sharpness = 10.0 * log(uFxClip.y / uFxClip.x);
  vec2 stride = vec2(${dir}) * texel() * uBlur.x;
  float sum = c.r;
  float weight = 1.0;
  for (int i = -2; i <= 2; i++) {
    if (i == 0) { continue; }
    vec4 s = sampleColor(uv + stride * float(i));
    float w = max(1.0 - abs(s.g + s.b / 255.0 - zc) * sharpness, 0.0);
    sum += s.r * w;
    weight += w;
  }
  return vec4(sum / weight, c.g, c.b, 1.0);
}
`,
  };
}

const BLUR_X_FRAGMENT = blurFragment('x');

const BLUR_Y_FRAGMENT = blurFragment('y');

/** Darkens RGB only and keeps the chain image's alpha, so a view composited over 2D keeps its edges */
const MERGE_FRAGMENT: EffectFragment = {
  gpu: /* wgsl */ `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let base = sampleColor(uv);
  return vec4<f32>(base.rgb * sampleColor2(uv).r, base.a);
}
`,
  gl: /* glsl */ `
vec4 effect(vec2 uv) {
  vec4 base = sampleColor(uv);
  return vec4(base.rgb * sampleColor2(uv).r, base.a);
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
   * An occluder counts less the further it is in depth from the shaded point, which keeps a near
   * object from casting a dark halo on what's far behind it. Lower it if halos show.
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
   * Depths in front of the camera, `[start, end]` in world units, across which the occlusion fades out
   *
   * Past `end` the effect skips its samples, which saves their cost and removes the speckle and
   * dark bands it gives distant surfaces. `null` keeps occlusion at every depth.
   * @default null
   * @example
   * ```ts
   * new SsaoEffect({ fadeDistance: [40, 80] });
   * ```
   */
  fadeDistance?: [number, number] | null;
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
   * Texels per logical pixel for the occlusion, like a pixi filter's `resolution`
   *
   * `'inherit'` matches the scene, at {@link View3D#resolution}. On a high-DPI screen `1` is the
   * usual choice: a quarter of the work at a device pixel ratio of 2. Fixed at construction.
   * @default 'inherit'
   * @example
   * ```ts
   * new SsaoEffect({ resolution: 1 });
   * ```
   */
  resolution?: number | 'inherit';
  /**
   * Whether the effect makes the view write {@link normalOutput}, so it reads each surface's own
   * normal instead of rebuilding a flat one from depth
   *
   * The scene's normal is smooth across curves and carries normal-map detail, but it costs every
   * opaque and glass pixel one more 4-byte write, which on a phone can cost more than it saves, and
   * on WebGL it turns the view's MSAA off; see {@link normalOutput}. When another pass already makes
   * the view write the normals, the effect reads them whatever this says. Fixed at construction.
   * @default false
   * @example
   * ```ts
   * new SsaoEffect({ sceneNormals: true });
   * ```
   */
  sceneNormals?: boolean;
}

/**
 * Screen-space ambient occlusion: darkens creases, corners and contact points
 *
 * Costs four fullscreen passes, three of them at `resolution`. Every property can change every
 * frame; the `resolution` and `sceneNormals` options are fixed at construction.
 * @example
 * ```ts
 * view.passes = [new SsaoEffect({ radius: 0.35, resolution: 1 })];
 * ```
 * @category extras:post-processing
 * @standard
 */
export class SsaoEffect extends PostEffect {
  /**
   * Defaults for every new `SsaoEffect`; an option passed as `undefined` keeps its default
   *
   * `maxDistance` has no entry, so unless set it starts at 0.65 × the resolved `radius`.
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
    fadeDistance: null,
    resolution: 'inherit',
    sceneNormals: false,
  };

  /** `[normalOutput]` when `sceneNormals` is set, otherwise `undefined` */
  // oxlint-disable-next-line pixi3d/require-standard-example -- set from `sceneNormals`; the view reads it, users don't
  public override readonly requiredOutputs?: readonly SceneOutput[];

  private readonly _computeUniforms = new UniformGroup({
    uParams: { value: new Float32Array(4), type: 'vec4<f32>' },
    uRange: { value: new Float32Array(4), type: 'vec4<f32>' },
  });

  private readonly _blurUniforms = new UniformGroup({
    uBlur: { value: new Float32Array(4), type: 'vec4<f32>' },
  });

  private readonly _resolution: number | 'inherit';

  constructor(options: SsaoEffectOptions = {}) {
    const {
      radius,
      maxDistance,
      intensity,
      bias,
      power,
      samples,
      blurStep,
      fadeDistance,
      resolution,
      sceneNormals,
      ...rest
    } = {
      ...SsaoEffect.defaultOptions,
      ...definedProps(options),
    };

    super(rest);
    this._resolution = resolution!;
    this.requiredOutputs = sceneNormals ? [normalOutput] : undefined;

    this.radius = radius!;
    this.maxDistance = maxDistance ?? radius! * 0.65;
    this.intensity = intensity!;
    this.bias = bias!;
    this.power = power!;
    this.samples = samples!;
    this.blurStep = blurStep!;
    this.fadeDistance = fadeDistance!;
  }

  /**
   * Adds the occlusion, blur and merge passes for this slot in the chain
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
    const sceneNormals = graph.hasSceneOutput(normalOutput);
    const ao = graph.createColor({ resolution: this._resolution, format: 'rgba8unorm', label: 'ssaoAO' });
    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'ssao:compute',
        fragment: sceneNormals ? SCENE_NORMAL_FRAGMENT : DEPTH_NORMAL_FRAGMENT,
        uniforms: this._computeUniforms,
        reads: {
          depth: graph.sceneDepth,
          color: sceneNormals ? graph.getSceneOutput(normalOutput) : undefined,
        },
        writes: ao,
      }),
    );

    const across = graph.createColor({ resolution: this._resolution, format: 'rgba8unorm', label: 'ssaoBlurX' });
    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'ssao:blurX',
        fragment: BLUR_X_FRAGMENT,
        uniforms: this._blurUniforms,
        reads: { color: ao },
        writes: across,
      }),
    );

    const blurred = graph.createColor({ resolution: this._resolution, format: 'rgba8unorm', label: 'ssaoBlur' });
    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'ssao:blurY',
        fragment: BLUR_Y_FRAGMENT,
        uniforms: this._blurUniforms,
        reads: { color: across },
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
   * @param value - Depth offset in world units.
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
   * Depth gap in world units at which an occluder stops counting; see {@link SsaoEffectOptions#maxDistance}
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
   * @param value - Depth gap in world units.
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
   * Sets the spacing between blur taps
   * @param value - Spacing in texels.
   */
  public set blurStep(value: number) {
    this.writeLane(this._blurUniforms, 'uBlur', 0, value);
  }

  /**
   * Depths `[start, end]` across which the occlusion fades out, or `null` for none; see
   * {@link SsaoEffectOptions#fadeDistance}
   * @example
   * ```ts
   * ssao.fadeDistance = [40, 80];
   * ```
   */
  public get fadeDistance(): [number, number] | null {
    const range = this._computeUniforms.uniforms.uRange as Float32Array;

    return range[3] > 0 ? [range[2], range[3]] : null;
  }
  /**
   * Sets the depths across which the occlusion fades out
   * @param value - `[start, end]` in world units, `end` above `start`, or `null` for no fade.
   */
  public set fadeDistance(value: [number, number] | null) {
    this.writeLane(this._computeUniforms, 'uRange', 2, value?.[0] ?? 0);
    this.writeLane(this._computeUniforms, 'uRange', 3, value?.[1] ?? 0);
  }
}
