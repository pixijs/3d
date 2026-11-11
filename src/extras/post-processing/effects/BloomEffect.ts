import { definedProps, UniformGroup } from 'pixi.js';

import type { RenderGraph } from '../../../core/render-graph/RenderGraph';
import type { ColorHandle } from '../../../core/render-graph/ResourceHandle';
import { floatRgbFormat } from '../../../core/textures/floatRenderTargets';
import { FullscreenPass } from '../../../post-processing/effects/FullscreenPass';
import { PostEffect } from '../../../post-processing/effects/PostEffect';
import type { EffectFragment, EffectIO, PostEffectOptions } from '../../../post-processing/effects/PostEffect';

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

/** Writes `radius` to alpha, so the `'normal'` blend its pass sets in `build` gives `mix(finer, coarser, radius)` */
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

/** Adds RGB only and keeps the chain image's alpha, since the glow adds light, not coverage */
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
 * @example
 * ```ts
 * const options: BloomEffectOptions = { threshold: 0.5, intensity: 1.2, levels: 6 };
 * view3d.passes = [new BloomEffect(options)];
 * ```
 * @category extras:post-processing
 * @standard
 */
export interface BloomEffectOptions extends PostEffectOptions {
  /**
   * Brightness above which a pixel blooms, measured on its brightest channel
   *
   * A pixel blooms with the brightness it has above the threshold, eased in from half the
   * threshold, so the cut-off is soft. At the default stage it's measured before the tone curve, so `1` blooms mostly what is
   * brighter than white.
   * @default 1
   * @example
   * ```ts
   * new BloomEffect({ threshold: 0.5 });
   * ```
   */
  threshold?: number;
  /**
   * Strength of the glow added back onto the frame
   * @default 1
   * @example
   * ```ts
   * new BloomEffect({ intensity: 2 });
   * ```
   */
  intensity?: number;
  /**
   * How much each coarser level blends into the finer one, `0` to `1`
   *
   * `0` keeps only the finest level, a tight halo. `1` replaces each level with the coarser one,
   * the widest and softest haze.
   * @default 0.6
   * @example
   * ```ts
   * new BloomEffect({ radius: 0.9 });
   * ```
   */
  radius?: number;
  /**
   * Number of blur levels; each is half the size of the last and doubles the glow's reach
   *
   * Rounded to a whole number, at least 1. Fixed at construction.
   * @default 5
   * @example
   * ```ts
   * new BloomEffect({ levels: 3 });
   * ```
   */
  levels?: number;
  /**
   * Texels per logical pixel for the largest blur level, like a pixi filter's `resolution`
   *
   * A glow has no fine detail, so a fraction is the usual choice. Fixed at construction.
   * @default 0.5
   * @example
   * ```ts
   * new BloomEffect({ resolution: 0.25 });
   * ```
   */
  resolution?: number;
}

/**
 * Bright parts of the frame glow outward
 *
 * The effect keeps what's brighter than `threshold`, blurs it through `levels` textures, each half
 * the size of the last, and adds the result back onto the frame. That costs `2 × levels` passes,
 * all but the last at `resolution` or smaller. `threshold`, `intensity` and `radius` can change
 * every frame; `levels` and `resolution` are fixed, so replace the effect to change them.
 *
 * By default it runs before the tone curve, where emissive surfaces, lights and specular glints
 * are still brighter than 1, so they glow in their own colour. Lower `threshold` to let bright but
 * ordinary surfaces glow too, for a hazier look.
 * @example
 * ```ts
 * view.passes = [new BloomEffect({ intensity: 0.6 })];
 * ```
 * @category extras:post-processing
 * @standard
 */
export class BloomEffect extends PostEffect {
  /**
   * Defaults for every new `BloomEffect`; an option passed as `undefined` keeps its default
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

  /**
   * Number of blur levels, fixed at construction
   * @advanced
   */
  public readonly levels: number = 0;
  /**
   * Texels per logical pixel for the largest blur level, fixed at construction
   * @advanced
   */
  public readonly resolution: number = 0;

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
   * Adds the effect's passes for this slot in the chain
   * @param graph - Render graph being built.
   * @param io - Input/output handles for this slot in the chain.
   * @example
   * ```ts
   * const glow = graph.createColor({ label: 'glow' });
   * bloom.build(graph, { ...io, output: glow });
   * ```
   * @advanced
   */
  public override build(graph: RenderGraph, io: EffectIO): void {
    const format = graph.sceneIsLinear ? floatRgbFormat(io.renderer) : undefined;
    const levels: ColorHandle[] = [];
    for (let k = 0; k < this.levels; k++) {
      levels.push(graph.createColor({ resolution: this.resolution / 2 ** k, format, label: `bloomLevel${k}` }));
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

  /**
   * Brightness above which a pixel blooms; {@link BloomEffectOptions#threshold} has the details
   * @example
   * ```ts
   * bloom.threshold = 0.4;
   * ```
   */
  public get threshold(): number {
    return (this._brightUniforms.uniforms.uBloom as Float32Array)[0];
  }
  /**
   * Sets the bloom threshold
   * @param value - Brightness of a pixel's brightest channel.
   */
  public set threshold(value: number) {
    this.writeLane(this._brightUniforms, 'uBloom', 0, value);
    this.writeLane(this._brightUniforms, 'uBloom', 1, value * 0.5);
  }

  /**
   * Strength of the glow added back onto the frame
   *
   * `0` hides the glow, but every pass still runs; set `enabled` to `false` to skip them.
   * @example
   * ```ts
   * bloom.intensity = 1 + Math.sin(time) * 0.5;
   * ```
   */
  public get intensity(): number {
    return (this._combineUniforms.uniforms.uBloomCombine as Float32Array)[0];
  }
  /**
   * Sets the glow strength
   * @param value - Multiplier on the glow.
   */
  public set intensity(value: number) {
    this.writeLane(this._combineUniforms, 'uBloomCombine', 0, value);
  }

  /**
   * How much each coarser level blends into the finer one, `0` (tight) to `1` (wide)
   * @example
   * ```ts
   * bloom.radius = 0.85;
   * ```
   */
  public get radius(): number {
    return (this._upUniforms.uniforms.uBloomUp as Float32Array)[0];
  }
  /**
   * Sets how far the glow spreads
   * @param value - `0` (tight) to `1` (wide).
   */
  public set radius(value: number) {
    this.writeLane(this._upUniforms, 'uBloomUp', 0, value);
  }
}
