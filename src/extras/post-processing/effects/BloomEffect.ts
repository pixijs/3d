import { definedProps, UniformGroup } from 'pixi.js';

import type { RenderGraph } from '../../../core/render-graph/RenderGraph';
import type { ColorHandle } from '../../../core/render-graph/ResourceHandle';
import { FullscreenPass } from '../../../post-processing/effects/FullscreenPass';
import { PostEffect } from '../../../post-processing/effects/PostEffect';
import type { EffectFragment, EffectIO, PostEffectOptions } from '../../../post-processing/effects/PostEffect';

// -- Pass 1: bright extract ---------------------------------------------------
// Keeps only what exceeds the threshold, with a quadratic knee straddling it
// so the cut-off never shows as a hard edge, and writes the survivors into
// level 0 of the pyramid. The four diagonal taps, one input texel out, box the
// chain image down on the way, so single bright texels don't flicker as the
// camera moves. The hue is kept: the pixel is scaled, not clipped.
// uBloom = (threshold, knee, _, _).

const BRIGHT_FRAGMENT: EffectFragment = {
  gpu: /* wgsl */ `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let t = inputTexel();
  let c = 0.25 * (sampleColor(uv + vec2<f32>(-t.x, -t.y)) + sampleColor(uv + vec2<f32>(t.x, -t.y))
    + sampleColor(uv + vec2<f32>(-t.x, t.y)) + sampleColor(uv + vec2<f32>(t.x, t.y)));
  let threshold = fx.uBloom.x;
  let knee = fx.uBloom.y;
  let brightness = max(c.r, max(c.g, c.b));
  var soft = clamp(brightness - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 0.00001);
  let contribution = max(soft, brightness - threshold) / max(brightness, 0.00001);
  return vec4<f32>(c.rgb * contribution, 1.0);
}
`,
  gl: /* glsl */ `
vec4 effect(vec2 uv) {
  vec2 t = inputTexel();
  vec4 c = 0.25 * (sampleColor(uv + vec2(-t.x, -t.y)) + sampleColor(uv + vec2(t.x, -t.y))
    + sampleColor(uv + vec2(-t.x, t.y)) + sampleColor(uv + vec2(t.x, t.y)));
  float threshold = uBloom.x;
  float knee = uBloom.y;
  float brightness = max(c.r, max(c.g, c.b));
  float soft = clamp(brightness - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 0.00001);
  float contribution = max(soft, brightness - threshold) / max(brightness, 0.00001);
  return vec4(c.rgb * contribution, 1.0);
}
`,
};

// -- Pass 2..N: downsample ----------------------------------------------------
// Each level is the one above at half size through a 13-tap kernel: a 2×2 of
// bilinear taps at ±1 source texel carrying half the weight, plus a 3×3 grid at
// ±2 texels for the rest. The overlapping footprints are what stop a single
// bright texel from flickering between levels. Offsets are in source texels.

const DOWN_FRAGMENT: EffectFragment = {
  gpu: /* wgsl */ `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let t = inputTexel();
  let a = sampleColor(uv + vec2<f32>(-2.0, 2.0) * t).rgb;
  let b = sampleColor(uv + vec2<f32>(0.0, 2.0) * t).rgb;
  let c = sampleColor(uv + vec2<f32>(2.0, 2.0) * t).rgb;
  let d = sampleColor(uv + vec2<f32>(-2.0, 0.0) * t).rgb;
  let e = sampleColor(uv).rgb;
  let f = sampleColor(uv + vec2<f32>(2.0, 0.0) * t).rgb;
  let g = sampleColor(uv + vec2<f32>(-2.0, -2.0) * t).rgb;
  let h = sampleColor(uv + vec2<f32>(0.0, -2.0) * t).rgb;
  let i = sampleColor(uv + vec2<f32>(2.0, -2.0) * t).rgb;
  let j = sampleColor(uv + vec2<f32>(-1.0, 1.0) * t).rgb;
  let k = sampleColor(uv + vec2<f32>(1.0, 1.0) * t).rgb;
  let l = sampleColor(uv + vec2<f32>(-1.0, -1.0) * t).rgb;
  let m = sampleColor(uv + vec2<f32>(1.0, -1.0) * t).rgb;
  let color = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  return vec4<f32>(color, 1.0);
}
`,
  gl: /* glsl */ `
vec4 effect(vec2 uv) {
  vec2 t = inputTexel();
  vec3 a = sampleColor(uv + vec2(-2.0, 2.0) * t).rgb;
  vec3 b = sampleColor(uv + vec2(0.0, 2.0) * t).rgb;
  vec3 c = sampleColor(uv + vec2(2.0, 2.0) * t).rgb;
  vec3 d = sampleColor(uv + vec2(-2.0, 0.0) * t).rgb;
  vec3 e = sampleColor(uv).rgb;
  vec3 f = sampleColor(uv + vec2(2.0, 0.0) * t).rgb;
  vec3 g = sampleColor(uv + vec2(-2.0, -2.0) * t).rgb;
  vec3 h = sampleColor(uv + vec2(0.0, -2.0) * t).rgb;
  vec3 i = sampleColor(uv + vec2(2.0, -2.0) * t).rgb;
  vec3 j = sampleColor(uv + vec2(-1.0, 1.0) * t).rgb;
  vec3 k = sampleColor(uv + vec2(1.0, 1.0) * t).rgb;
  vec3 l = sampleColor(uv + vec2(-1.0, -1.0) * t).rgb;
  vec3 m = sampleColor(uv + vec2(1.0, -1.0) * t).rgb;
  vec3 color = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  return vec4(color, 1.0);
}
`,
};

// -- Pass N+1..2N-1: upsample -------------------------------------------------
// Walks back up the pyramid. Each pass reads the coarser level with four
// bilinear taps at half-texel offsets (the 3×3 tent in four fetches) and blends
// it over the finer level in place: the output is premultiplied with `radius`
// in alpha, so the fixed-function 'normal' blend lands
// `finer = mix(finer, tent(coarser), radius)`. Tent of tent of tent is close to
// a Gaussian, which is why the glow reads smooth rather than blobby.
// uBloomUp = (radius, _, _, _).

const UP_FRAGMENT: EffectFragment = {
  gpu: /* wgsl */ `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let o = 0.5 * inputTexel();
  let tent = 0.25 * (sampleColor(uv + vec2<f32>(-o.x, -o.y)) + sampleColor(uv + vec2<f32>(o.x, -o.y))
    + sampleColor(uv + vec2<f32>(-o.x, o.y)) + sampleColor(uv + vec2<f32>(o.x, o.y)));
  let radius = fx.uBloomUp.x;
  return vec4<f32>(tent.rgb * radius, radius);
}
`,
  gl: /* glsl */ `
vec4 effect(vec2 uv) {
  vec2 o = 0.5 * inputTexel();
  vec4 tent = 0.25 * (sampleColor(uv + vec2(-o.x, -o.y)) + sampleColor(uv + vec2(o.x, -o.y))
    + sampleColor(uv + vec2(-o.x, o.y)) + sampleColor(uv + vec2(o.x, o.y)));
  float radius = uBloomUp.x;
  return vec4(tent.rgb * radius, radius);
}
`,
};

// -- Pass 2N: combine ---------------------------------------------------------
// Two taps: the chain image plus level 0 of the pyramid, magnified. RGB only:
// bloom adds light, never coverage.
// uBloomCombine = (intensity, _, _, _).

const COMBINE_FRAGMENT: EffectFragment = {
  gpu: /* wgsl */ `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let base = sampleColor(uv);
  return vec4<f32>(base.rgb + sampleColor2(uv).rgb * fx.uBloomCombine.x, base.a);
}
`,
  gl: /* glsl */ `
vec4 effect(vec2 uv) {
  vec4 base = sampleColor(uv);
  return vec4(base.rgb + sampleColor2(uv).rgb * uBloomCombine.x, base.a);
}
`,
};

/**
 * Constructor options for {@link BloomEffect}
 * @category extras:post-processing
 * @standard
 */
export interface BloomEffectOptions extends PostEffectOptions {
  /**
   * Brightness above which a pixel blooms, in the chain image's units
   *
   * Measured on the brightest channel. A soft knee half the threshold wide on either side of
   * it fades the cut-off in rather than switching it on: bloom starts at half the threshold
   * and is fully in by one and a half times it.
   * @default 1
   */
  threshold?: number;
  /**
   * Strength of the glow added back onto the frame
   * @default 1
   */
  intensity?: number;
  /**
   * How much each coarser level blends into the finer one, `0` to `1`
   *
   * `0` keeps only the finest level (a tight halo), `1` replaces each level with the one
   * below it (the widest, softest haze).
   * @default 0.6
   */
  radius?: number;
  /**
   * Depth of the pyramid; each level halves the previous one and doubles the reach
   *
   * Construction-only: every level is a texture the effect allocates from the graph. Rounded
   * to a whole number, at least 1.
   * @default 5
   */
  levels?: number;
  /**
   * Resolution of the pyramid's top level in device pixels per logical pixel — pixi's meaning,
   * as on filters
   *
   * Bloom is low-frequency by nature, so a fraction of the view is the usual choice: `0.5` is
   * half a logical pixel, a quarter of a DPR-2 viewport. Construction-only.
   * @default 0.5
   */
  resolution?: number;
}

/**
 * Bloom: bright parts of the frame glow outward
 *
 * A progressive pyramid. A bright extract writes level 0 at `resolution`; each level below
 * is a 13-tap downsample of the one above at half its size; then the walk back up blends each
 * coarser level over the finer one with a tent filter; a two-tap combine adds level 0 onto
 * the frame. `2 × levels` small passes, none of them at screen size but the combine.
 *
 * `threshold`, `intensity` and `radius` are live uniform writes. `levels` and `resolution`
 * are construction-only, since each level is a graph texture.
 *
 * The threshold is applied to whatever the chain carries at this slot: display-encoded values
 * when the view tone-maps its materials, so only near-white pixels bloom at the default
 * threshold; lower it to catch bright highlights.
 * @example
 * ```ts
 * view.passes = [new BloomEffect({ threshold: 0.8, intensity: 0.6 })];
 * ```
 * @category extras:post-processing
 * @standard
 */
export class BloomEffect extends PostEffect {
  /**
   * Default {@link BloomEffectOptions} merged under every constructor call
   *
   * `new BloomEffect(opts)` resolves as `{ ...BloomEffect.defaultOptions, ...opts }`. Mutate to change defaults
   * process-wide.
   * @example
   * ```ts
   * BloomEffect.defaultOptions.resolution = 0.25;
   * ```
   */
  public static defaultOptions: BloomEffectOptions = {
    threshold: 1,
    intensity: 1,
    radius: 0.6,
    levels: 5,
    resolution: 0.5,
  };

  /** Depth of the pyramid, fixed at construction */
  public readonly levels: number;
  /** Resolution of the pyramid's top level, fixed at construction */
  public readonly resolution: number;

  private readonly _brightUniforms = new UniformGroup({
    uBloom: { value: new Float32Array(4), type: 'vec4<f32>' },
  });

  private readonly _upUniforms = new UniformGroup({
    uBloomUp: { value: new Float32Array(4), type: 'vec4<f32>' },
  });

  private readonly _combineUniforms = new UniformGroup({
    uBloomCombine: { value: new Float32Array(4), type: 'vec4<f32>' },
  });

  constructor(options: BloomEffectOptions = {}) {
    const { threshold, intensity, radius, levels, resolution, ...rest } = {
      ...BloomEffect.defaultOptions,
      ...definedProps(options),
    };

    super(rest);
    this.levels = Math.max(1, Math.round(levels!));
    this.resolution = resolution!;

    this.threshold = threshold!;
    this.intensity = intensity!;
    this.radius = radius!;
  }

  /**
   * Add the bright extract, the downsample and upsample walks, and the combine for this slot
   * @param graph - Render graph being built.
   * @param io - Input/output handles for this slot in the chain.
   */
  public override build(graph: RenderGraph, io: EffectIO): void {
    const levels: ColorHandle[] = [];
    for (let k = 0; k < this.levels; k++) {
      levels.push(graph.createColor({ resolution: this.resolution / 2 ** k, label: `bloomLevel${k}` }));
    }

    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'bloom:bright',
        fragment: BRIGHT_FRAGMENT,
        uniforms: this._brightUniforms,
        reads: { color: io.input },
        writes: levels[0],
      }),
    );

    for (let k = 1; k < this.levels; k++) {
      graph.addPass(
        new FullscreenPass({
          renderer: io.renderer,
          label: `bloom:down${k}`,
          fragment: DOWN_FRAGMENT,
          reads: { color: levels[k - 1] },
          writes: levels[k],
        }),
      );
    }

    for (let k = this.levels - 2; k >= 0; k--) {
      graph.addPass(
        new FullscreenPass({
          renderer: io.renderer,
          label: `bloom:up${k}`,
          fragment: UP_FRAGMENT,
          uniforms: this._upUniforms,
          reads: { color: levels[k + 1] },
          writes: levels[k],
          blendMode: 'normal',
        }),
      );
    }

    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'bloom:combine',
        fragment: COMBINE_FRAGMENT,
        uniforms: this._combineUniforms,
        reads: { color: io.input, color2: levels[0] },
        writes: io.output,
      }),
    );
  }

  // --- Live params: plain lane writes, visible next frame ---

  /** Brightness above which a pixel blooms */
  public get threshold(): number {
    return (this._brightUniforms.uniforms.uBloom as Float32Array)[0];
  }
  /**
   * Sets the bloom threshold and its soft knee (half the threshold, either side of it)
   * @param value - Brightness of the brightest channel at the middle of the knee.
   */
  public set threshold(value: number) {
    this.writeLane(this._brightUniforms, 'uBloom', 0, value);
    this.writeLane(this._brightUniforms, 'uBloom', 1, value * 0.5);
  }

  /** Strength of the glow added back onto the frame */
  public get intensity(): number {
    return (this._combineUniforms.uniforms.uBloomCombine as Float32Array)[0];
  }
  /**
   * Sets the glow strength
   * @param value - Multiplier on the glow; 0 turns the bloom off.
   */
  public set intensity(value: number) {
    this.writeLane(this._combineUniforms, 'uBloomCombine', 0, value);
  }

  /** How much each coarser level blends into the finer one, `0` (tight) to `1` (wide) */
  public get radius(): number {
    return (this._upUniforms.uniforms.uBloomUp as Float32Array)[0];
  }
  /**
   * Sets the per-level blend that spreads the glow
   * @param value - `0` keeps only the finest level, `1` replaces each level with the coarser one.
   */
  public set radius(value: number) {
    this.writeLane(this._upUniforms, 'uBloomUp', 0, value);
  }
}
