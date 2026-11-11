import { definedProps, UniformGroup } from 'pixi.js';

import { PostEffect } from '../../../post-processing/effects/PostEffect';
import type { EffectFragment, PostEffectOptions } from '../../../post-processing/effects/PostEffect';

/**
 * FXAA 3.11, console form. Alpha is tested too, as premultiplied dark and clear pixels share RGB; the larger range
 * wins, since a sum cancels where brightness rises as alpha falls. The 1/384 nudges keep `normalize` off a zero vector.
 */
const FXAA_FRAGMENT: EffectFragment = {
  gpu: /* wgsl */ `
fn fxaaLuma(color: vec4<f32>) -> f32 {
  return dot(color.rgb, vec3<f32>(0.299, 0.587, 0.114));
}
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let px = inputTexel();
  let halfTexel = px * 0.5;
  let colorNw = sampleColor(uv + vec2<f32>(-halfTexel.x, -halfTexel.y));
  let colorSw = sampleColor(uv + vec2<f32>(-halfTexel.x, halfTexel.y));
  let colorNe = sampleColor(uv + vec2<f32>(halfTexel.x, -halfTexel.y));
  let colorSe = sampleColor(uv + vec2<f32>(halfTexel.x, halfTexel.y));
  let center = sampleColor(uv);
  let lumaNw = fxaaLuma(colorNw);
  let lumaSw = fxaaLuma(colorSw);
  let lumaNe = fxaaLuma(colorNe) + 1.0 / 384.0;
  let lumaSe = fxaaLuma(colorSe);
  let lumaM = fxaaLuma(center);

  let lumaMax = max(max(lumaNe, lumaSe), max(lumaNw, lumaSw));
  let lumaMin = min(min(lumaNe, lumaSe), min(lumaNw, lumaSw));
  let lumaRange = max(lumaMax, lumaM) - min(lumaMin, lumaM);
  let alphaMax = max(max(colorNe.a, colorSe.a), max(colorNw.a, colorSw.a));
  let alphaMin = min(min(colorNe.a, colorSe.a), min(colorNw.a, colorSw.a));
  let alphaRange = max(alphaMax, center.a) - min(alphaMin, center.a);
  if (max(lumaRange, alphaRange) < max(fx.uFxaa.y, lumaMax * fx.uFxaa.x)) {
    return center;
  }

  let byAlpha = alphaRange > lumaRange;
  let dirSwMinusNe = select(lumaSw - lumaNe, colorSw.a - colorNe.a - 1.0 / 384.0, byAlpha);
  let dirSeMinusNw = select(lumaSe - lumaNw, colorSe.a - colorNw.a, byAlpha);
  let dir1 = normalize(vec2<f32>(dirSwMinusNe + dirSeMinusNw, dirSwMinusNe - dirSeMinusNw));
  let colorN1 = sampleColor(uv - dir1 * halfTexel);
  let colorP1 = sampleColor(uv + dir1 * halfTexel);

  let dirAbsMinTimesC = max(min(abs(dir1.x), abs(dir1.y)) * fx.uFxaa.z, 1e-6);
  let dir2 = clamp(dir1 / dirAbsMinTimesC, vec2<f32>(-2.0), vec2<f32>(2.0));
  let colorN2 = sampleColor(uv - dir2 * px * 2.0);
  let colorP2 = sampleColor(uv + dir2 * px * 2.0);

  let colorA = colorN1 + colorP1;
  let colorB = (colorN2 + colorP2) * 0.25 + colorA * 0.25;
  let edgeB = select(fxaaLuma(colorB), colorB.a, byAlpha);
  let edgeMin = select(lumaMin, alphaMin, byAlpha);
  let edgeMax = select(lumaMax, alphaMax, byAlpha);
  return select(colorB, colorA * 0.5, edgeB < edgeMin || edgeB > edgeMax);
}
`,
  gl: /* glsl */ `
float fxaaLuma(vec4 color) {
  return dot(color.rgb, vec3(0.299, 0.587, 0.114));
}
vec4 effect(vec2 uv) {
  vec2 px = inputTexel();
  vec2 halfTexel = px * 0.5;
  vec4 colorNw = sampleColor(uv + vec2(-halfTexel.x, -halfTexel.y));
  vec4 colorSw = sampleColor(uv + vec2(-halfTexel.x, halfTexel.y));
  vec4 colorNe = sampleColor(uv + vec2(halfTexel.x, -halfTexel.y));
  vec4 colorSe = sampleColor(uv + vec2(halfTexel.x, halfTexel.y));
  vec4 center = sampleColor(uv);
  float lumaNw = fxaaLuma(colorNw);
  float lumaSw = fxaaLuma(colorSw);
  float lumaNe = fxaaLuma(colorNe) + 1.0 / 384.0;
  float lumaSe = fxaaLuma(colorSe);
  float lumaM = fxaaLuma(center);

  float lumaMax = max(max(lumaNe, lumaSe), max(lumaNw, lumaSw));
  float lumaMin = min(min(lumaNe, lumaSe), min(lumaNw, lumaSw));
  float lumaRange = max(lumaMax, lumaM) - min(lumaMin, lumaM);
  float alphaMax = max(max(colorNe.a, colorSe.a), max(colorNw.a, colorSw.a));
  float alphaMin = min(min(colorNe.a, colorSe.a), min(colorNw.a, colorSw.a));
  float alphaRange = max(alphaMax, center.a) - min(alphaMin, center.a);
  if (max(lumaRange, alphaRange) < max(uFxaa.y, lumaMax * uFxaa.x)) {
    return center;
  }

  bool byAlpha = alphaRange > lumaRange;
  float dirSwMinusNe = byAlpha ? colorSw.a - colorNe.a - 1.0 / 384.0 : lumaSw - lumaNe;
  float dirSeMinusNw = byAlpha ? colorSe.a - colorNw.a : lumaSe - lumaNw;
  vec2 dir1 = normalize(vec2(dirSwMinusNe + dirSeMinusNw, dirSwMinusNe - dirSeMinusNw));
  vec4 colorN1 = sampleColor(uv - dir1 * halfTexel);
  vec4 colorP1 = sampleColor(uv + dir1 * halfTexel);

  float dirAbsMinTimesC = max(min(abs(dir1.x), abs(dir1.y)) * uFxaa.z, 1e-6);
  vec2 dir2 = clamp(dir1 / dirAbsMinTimesC, -2.0, 2.0);
  vec4 colorN2 = sampleColor(uv - dir2 * px * 2.0);
  vec4 colorP2 = sampleColor(uv + dir2 * px * 2.0);

  vec4 colorA = colorN1 + colorP1;
  vec4 colorB = (colorN2 + colorP2) * 0.25 + colorA * 0.25;
  float edgeB = byAlpha ? colorB.a : fxaaLuma(colorB);
  float edgeMin = byAlpha ? alphaMin : lumaMin;
  float edgeMax = byAlpha ? alphaMax : lumaMax;
  return (edgeB < edgeMin || edgeB > edgeMax) ? colorA * 0.5 : colorB;
}
`,
};

/**
 * Constructor options for {@link FxaaEffect}
 * @example
 * ```ts
 * const options: FxaaEffectOptions = { edgeThreshold: 0.166, edgeSharpness: 4 };
 * view3d.passes = [new FxaaEffect(options)];
 * ```
 * @category extras:post-processing
 * @standard
 */
export interface FxaaEffectOptions extends PostEffectOptions {
  /**
   * Smallest contrast that counts as an edge, as a fraction of the brightest pixel nearby
   *
   * Lower values smooth more edges and cost more. `0.25` is faster and leaves soft edges alone;
   * `0.0625` catches nearly everything.
   * @default 0.125
   * @example
   * ```ts
   * new FxaaEffect({ edgeThreshold: 0.166 });
   * ```
   */
  edgeThreshold?: number;
  /**
   * Smallest contrast that counts as an edge in any light, so dark areas aren't smoothed for
   * edges too faint to see
   * @default 0.05
   * @example
   * ```ts
   * new FxaaEffect({ edgeThresholdMin: 0.04 });
   * ```
   */
  edgeThresholdMin?: number;
  /**
   * How far the blend reaches along an edge; higher keeps the image sharper
   *
   * `8` is sharpest, `4` softer and `2` softest.
   * @default 8
   * @example
   * ```ts
   * new FxaaEffect({ edgeSharpness: 4 });
   * ```
   */
  edgeSharpness?: number;
}

/**
 * Smooths jagged edges by blurring along them, a cheap stand-in for multisampling
 *
 * Use it when the canvas has no `antialias`, or when a scene output's format turns MSAA off for the
 * view (see {@link SceneOutput}). It works on the finished image only, so it costs one fullscreen
 * pass whatever the scene holds.
 *
 * It runs after the tone curve by default, since it finds edges by their brightness on screen.
 * Put it last among the `'afterToneMapping'` effects: an effect after it can bring the jagged
 * edges back.
 * @example
 * ```ts
 * // On a canvas created with `antialias: false`
 * view.passes = [new BloomEffect({ threshold: 0.5 }), new FxaaEffect()];
 * ```
 * @category extras:post-processing
 * @standard
 */
export class FxaaEffect extends PostEffect {
  /**
   * Defaults for every new `FxaaEffect`; an option passed as `undefined` keeps its default
   * @example
   * ```ts
   * FxaaEffect.defaultOptions.edgeSharpness = 4;
   * ```
   */
  public static defaultOptions: FxaaEffectOptions = {
    stage: 'afterToneMapping',
    edgeThreshold: 0.125,
    edgeThresholdMin: 0.05,
    edgeSharpness: 8,
  };

  protected override readonly uniforms = new UniformGroup({
    uFxaa: { value: new Float32Array(4), type: 'vec4<f32>' },
  });

  protected readonly fragment: EffectFragment = FXAA_FRAGMENT;

  constructor(options: FxaaEffectOptions = {}) {
    const { edgeThreshold, edgeThresholdMin, edgeSharpness, ...rest } = {
      ...FxaaEffect.defaultOptions,
      ...definedProps(options),
    };

    super(rest);
    this.edgeThreshold = edgeThreshold!;
    this.edgeThresholdMin = edgeThresholdMin!;
    this.edgeSharpness = edgeSharpness!;
  }

  /**
   * Smallest contrast that counts as an edge, relative to the brightest pixel nearby;
   * {@link FxaaEffectOptions#edgeThreshold} has the details
   * @example
   * ```ts
   * fxaa.edgeThreshold = 0.166;
   * ```
   */
  public get edgeThreshold(): number {
    return (this.uniforms.uniforms.uFxaa as Float32Array)[0];
  }
  /**
   * Sets the relative contrast an edge needs
   * @param value - Fraction of the brightest nearby pixel's brightness.
   */
  public set edgeThreshold(value: number) {
    this.writeLane(this.uniforms, 'uFxaa', 0, value);
  }

  /**
   * Smallest contrast that counts as an edge in any light
   * @example
   * ```ts
   * fxaa.edgeThresholdMin = 0.04;
   * ```
   */
  public get edgeThresholdMin(): number {
    return (this.uniforms.uniforms.uFxaa as Float32Array)[1];
  }
  /**
   * Sets the absolute contrast floor for an edge
   * @param value - Brightness difference, `0` to `1`.
   */
  public set edgeThresholdMin(value: number) {
    this.writeLane(this.uniforms, 'uFxaa', 1, value);
  }

  /**
   * How far the blend reaches along an edge, `8` (sharpest) down to `2` (softest)
   * @example
   * ```ts
   * fxaa.edgeSharpness = 4;
   * ```
   */
  public get edgeSharpness(): number {
    return (this.uniforms.uniforms.uFxaa as Float32Array)[2];
  }
  /**
   * Sets how far the blend reaches along an edge
   * @param value - `8` keeps the image sharpest, `2` blends furthest.
   */
  public set edgeSharpness(value: number) {
    this.writeLane(this.uniforms, 'uFxaa', 2, value);
  }
}
