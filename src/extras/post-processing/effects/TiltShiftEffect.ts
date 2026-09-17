import { definedProps, UniformGroup } from 'pixi.js';

import type { RenderGraph } from '../../../core/render-graph/RenderGraph';
import { FullscreenPass } from '../../../post-processing/effects/FullscreenPass';
import { PostEffect } from '../../../post-processing/effects/PostEffect';
import type { EffectFragment, EffectIO, PostEffectOptions } from '../../../post-processing/effects/PostEffect';

// -- Depth-driven bokeh -------------------------------------------------------
// Derives a blur amount from each pixel's distance to the focal plane, then
// gathers a golden-angle disk of taps whose radius scales with it. Each tap
// samples a mip just coarse enough that the sparse disk never gaps, so the
// blur stays creamy instead of showing blocky mip texels. All four channels
// are averaged, so premultiplied coverage blurs correctly on inset views.
//
// The gather is occlusion-weighted (scatter-as-gather): a tap contributes
// only if its own blur disk could reach the shaded pixel. Taps at or behind
// the centre depth always can — they're the surface being blurred — while
// nearer taps count in proportion to their own blur radius, so a sharp
// in-focus object never smears into the blurred background around its
// silhouette. Weights renormalize, filling the background from background
// taps; blurry foregrounds keep full weight and still bleed over what's
// behind them.
// uFocus = (focalDepth, focalNear, focalFar, maxBlurPx); uTilt = (debug, _, _, _).

const TILT_FRAGMENT: EffectFragment = {
  gpu: /* wgsl */ `
const TS_TAPS: i32 = 16;
const TS_GOLDEN: f32 = 2.3999632; // golden angle (rad) — even spiral disk distribution

// Debug view: paint the depth field instead of blurring. Green = within the
// sharp band, warm = foreground blur, cool = background blur, ramp brightness
// = blur amount; the white isoline is the focal plane itself.
fn debugView(uv: vec2<f32>) -> vec4<f32> {
  let base = sampleColor(uv).rgb;
  let lz = linearDepth(sampleDepth(uv));
  let s = lz - fx.uFocus.x;
  let ad = abs(s);
  let blur = smoothstep(fx.uFocus.y, fx.uFocus.z, ad);
  let gray = dot(base, vec3<f32>(0.299, 0.587, 0.114));
  var blurCol = vec3<f32>(0.3, 0.55, 1.0);
  if (s < 0.0) { blurCol = vec3<f32>(1.0, 0.45, 0.2); }
  let zone = mix(vec3<f32>(0.25, 1.0, 0.45), blurCol, blur);
  var col = mix(vec3<f32>(gray) * 0.4, zone, 0.55);
  let th = fx.uFocus.z * 0.02 + 0.02;
  col = mix(col, vec3<f32>(1.0), (1.0 - smoothstep(0.0, th, ad)) * 0.9);
  return vec4<f32>(col, 1.0);
}

fn effect(uv: vec2<f32>) -> vec4<f32> {
  if (fx.uTilt.x > 0.5) { return debugView(uv); }
  let centerLz = linearDepth(sampleDepth(uv));
  let blur = smoothstep(fx.uFocus.y, fx.uFocus.z, abs(centerLz - fx.uFocus.x));
  let radiusPx = blur * fx.uFocus.w;
  if (radiusPx < 0.5) { return sampleColor(uv); }
  let lod = max(0.0, log2(radiusPx / sqrt(f32(TS_TAPS))));
  // Seed with the centre sample so the weight sum can never collapse (a sky
  // pixel ringed entirely by sharp taps would otherwise divide by zero).
  var sum = sampleColorLod(uv, lod);
  var wsum = 1.0;
  for (var i = 0; i < TS_TAPS; i = i + 1) {
    let t = (f32(i) + 0.5) / f32(TS_TAPS);
    let a = f32(i) * TS_GOLDEN;
    let distPx = sqrt(t) * radiusPx;
    let tapUv = uv + vec2<f32>(cos(a), sin(a)) * distPx * texel();
    let tapLz = linearDepth(sampleDepth(tapUv));
    let tapRadius = smoothstep(fx.uFocus.y, fx.uFocus.z, abs(tapLz - fx.uFocus.x)) * fx.uFocus.w;
    let w = select(clamp(tapRadius / max(distPx, 0.5), 0.0, 1.0), 1.0, tapLz >= centerLz);
    sum = sum + sampleColorLod(tapUv, lod) * w;
    wsum = wsum + w;
  }
  return sum / wsum;
}
`,
  gl: /* glsl */ `
const int TS_TAPS = 16;
const float TS_GOLDEN = 2.3999632; // golden angle (rad) — even spiral disk distribution

// Debug view: paint the depth field instead of blurring. Green = within the
// sharp band, warm = foreground blur, cool = background blur, ramp brightness
// = blur amount; the white isoline is the focal plane itself.
vec4 debugView(vec2 uv) {
  vec3 base = sampleColor(uv).rgb;
  float lz = linearDepth(sampleDepth(uv));
  float s = lz - uFocus.x;
  float ad = abs(s);
  float blur = smoothstep(uFocus.y, uFocus.z, ad);
  float gray = dot(base, vec3(0.299, 0.587, 0.114));
  vec3 blurCol = s < 0.0 ? vec3(1.0, 0.45, 0.2) : vec3(0.3, 0.55, 1.0);
  vec3 zone = mix(vec3(0.25, 1.0, 0.45), blurCol, blur);
  vec3 col = mix(vec3(gray) * 0.4, zone, 0.55);
  float th = uFocus.z * 0.02 + 0.02;
  col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, th, ad)) * 0.9);
  return vec4(col, 1.0);
}

vec4 effect(vec2 uv) {
  if (uTilt.x > 0.5) { return debugView(uv); }
  float centerLz = linearDepth(sampleDepth(uv));
  float blur = smoothstep(uFocus.y, uFocus.z, abs(centerLz - uFocus.x));
  float radiusPx = blur * uFocus.w;
  if (radiusPx < 0.5) { return sampleColor(uv); }
  float lod = max(0.0, log2(radiusPx / sqrt(float(TS_TAPS))));
  // Seed with the centre sample so the weight sum can never collapse (a sky
  // pixel ringed entirely by sharp taps would otherwise divide by zero).
  vec4 sum = sampleColorLod(uv, lod);
  float wsum = 1.0;
  for (int i = 0; i < TS_TAPS; i++) {
    float t = (float(i) + 0.5) / float(TS_TAPS);
    float a = float(i) * TS_GOLDEN;
    float distPx = sqrt(t) * radiusPx;
    vec2 tapUv = uv + vec2(cos(a), sin(a)) * distPx * texel();
    float tapLz = linearDepth(sampleDepth(tapUv));
    float tapRadius = smoothstep(uFocus.y, uFocus.z, abs(tapLz - uFocus.x)) * uFocus.w;
    float w = tapLz >= centerLz ? 1.0 : clamp(tapRadius / max(distPx, 0.5), 0.0, 1.0);
    sum += sampleColorLod(tapUv, lod) * w;
    wsum += w;
  }
  return sum / wsum;
}
`,
};

/**
 * Constructor options for {@link TiltShiftEffect}
 * @category extras:post-processing
 * @standard
 */
export interface TiltShiftEffectOptions extends PostEffectOptions {
  /**
   * View-space distance of the focal plane — it rides and rotates with the camera
   * @default 35
   */
  focalDepth?: number;
  /**
   * Half-width of the fully-sharp band, in view units
   * @default 3
   */
  focalNear?: number;
  /**
   * Distance from the focal plane at which the blur is maxed, in view units
   * @default 14
   */
  focalFar?: number;
  /**
   * Bokeh disk radius at full blur, in pixels — effectively the blur strength
   * @default 12
   */
  maxBlur?: number;
  /**
   * Paint the depth/blur field instead of blurring — see {@link TiltShiftEffect#debug}
   * @default false
   */
  debug?: boolean;
}

/**
 * Tilt-shift / miniature depth-of-field
 *
 * A narrow focal band stays sharp and everything in front of or behind it blurs hard, which
 * the brain reads as extreme close-up macro — so a normal scene looks like a tiny model
 * (helped by a high three-quarter camera).
 *
 * A single bokeh-gather pass: `inputMips` has the compiler deliver the chain input
 * mip-chained, so the gather LOD-samples it directly against the scene depth — no copy.
 * Every property is a live uniform write.
 * @example
 * ```ts
 * view.passes = [new TiltShiftEffect({ focalDepth: 35, maxBlur: 12 })];
 * ```
 * @category extras:post-processing
 * @standard
 */
export class TiltShiftEffect extends PostEffect {
  /**
   * Default {@link TiltShiftEffectOptions} merged under every constructor call
   *
   * `new TiltShiftEffect(opts)` resolves as `{ ...TiltShiftEffect.defaultOptions, ...opts }`. Mutate to change
   * defaults process-wide.
   * @example
   * ```ts
   * TiltShiftEffect.defaultOptions.maxBlur = 8;
   * ```
   */
  public static defaultOptions: TiltShiftEffectOptions = {
    focalDepth: 35,
    focalNear: 3,
    focalFar: 14,
    maxBlur: 12,
    debug: false,
  };

  /** Always samples coarse LODs, so the chain input is allocated mip-chained */
  public override readonly inputMips = true;

  private readonly _uniforms = new UniformGroup({
    uFocus: { value: new Float32Array(4), type: 'vec4<f32>' },
    uTilt: { value: new Float32Array(4), type: 'vec4<f32>' },
  });

  constructor(options: TiltShiftEffectOptions = {}) {
    const { focalDepth, focalNear, focalFar, maxBlur, debug, ...rest } = {
      ...TiltShiftEffect.defaultOptions,
      ...definedProps(options),
    };

    super(rest);

    this.focalDepth = focalDepth!;
    this.focalNear = focalNear!;
    this.focalFar = focalFar!;
    this.maxBlur = maxBlur!;
    this.debug = debug!;
  }

  /**
   * Add the single bokeh-gather pass, reading the mip-chained input and the scene depth
   * @param graph - Render graph being built.
   * @param io - Input/output handles for this slot in the chain.
   */
  public override build(graph: RenderGraph, io: EffectIO): void {
    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'tiltShift',
        fragment: TILT_FRAGMENT,
        uniforms: this._uniforms,
        reads: { color: io.input, depth: graph.sceneDepth },
        writes: io.output,
      }),
    );
  }

  // --- Live params: plain lane writes, visible next frame ---

  /** View-space distance of the focal plane */
  public get focalDepth(): number {
    return this._uniforms.uniforms.uFocus[0];
  }
  /**
   * Sets the focal-plane distance
   * @param value - Distance from the camera to the focal plane, in view units.
   */
  public set focalDepth(value: number) {
    this.writeLane(this._uniforms, 'uFocus', 0, value);
  }

  /** Half-width of the fully-sharp band, in view units */
  public get focalNear(): number {
    return this._uniforms.uniforms.uFocus[1];
  }
  /**
   * Sets the half-width of the fully-sharp band
   * @param value - Half-width in view units, measured from the focal plane.
   */
  public set focalNear(value: number) {
    this.writeLane(this._uniforms, 'uFocus', 1, value);
  }

  /** Distance from the focal plane at which the blur is maxed, in view units */
  public get focalFar(): number {
    return this._uniforms.uniforms.uFocus[2];
  }
  /**
   * Sets the distance at which the blur reaches maximum
   * @param value - Distance from the focal plane, in view units.
   */
  public set focalFar(value: number) {
    this.writeLane(this._uniforms, 'uFocus', 2, value);
  }

  /** Bokeh disk radius at full blur, in pixels — effectively the blur strength */
  public get maxBlur(): number {
    return this._uniforms.uniforms.uFocus[3];
  }
  /**
   * Sets the bokeh disk radius at full blur
   * @param value - Radius in pixels.
   */
  public set maxBlur(value: number) {
    this.writeLane(this._uniforms, 'uFocus', 3, value);
  }

  /**
   * Paint the depth/blur field instead of blurring, so the focal settings are legible
   *
   * White is the focal plane, green the sharp band, warm the foreground blur and cool the
   * background blur.
   */
  public get debug(): boolean {
    return this._uniforms.uniforms.uTilt[0] > 0.5;
  }
  /**
   * Toggles the debug visualisation of the depth/blur field
   * @param value - Whether to paint the depth/blur field instead of blurring.
   */
  public set debug(value: boolean) {
    this.writeLane(this._uniforms, 'uTilt', 0, value ? 1 : 0);
  }
}
