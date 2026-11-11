/**
 * An edge blur as a multi-pass post effect: `build()` adds two blur passes at a lower resolution and a pass that mixes
 * the blur in toward the frame's edges
 */

import { FullscreenPass, PostEffect } from '@pixi/3d';
import type { EffectFragment, EffectIO, PostEffectOptions, RenderGraph } from '@pixi/3d';
import { UniformGroup } from 'pixi.js';

/**
 * A 9-tap Gaussian blur along one direction. Two passes share it: one across with `uBlur = (spread, 0)` and one down
 * with `(0, spread)`. The engine wraps a fragment into a shader once, so passes that share one must declare the same
 * uniform names and types; only their values differ. `texel()` is one texel of the texture the pass draws into.
 */
const BLUR_FRAGMENT: EffectFragment = {
  gpu: /* wgsl */ `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let offset = fx.uBlur * texel();
  var sum = vec4(0.0);
  var total = 0.0;
  for (var i = -4; i <= 4; i++) {
    let weight = exp(-f32(i * i) / 8.0);
    sum += sampleColor(uv + offset * f32(i)) * weight;
    total += weight;
  }
  return sum / total;
}
`,
  gl: /* glsl */ `
vec4 effect(vec2 uv) {
  vec2 offset = uBlur * texel();
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -4; i <= 4; i++) {
    float weight = exp(-float(i * i) / 8.0);
    sum += sampleColor(uv + offset * float(i)) * weight;
    total += weight;
  }
  return sum / total;
}
`,
};

/** Mixes the frame (`color`) toward its blurred copy (`color2`) by distance from the centre, as the vignette darkens */
const MIX_FRAGMENT: EffectFragment = {
  gpu: /* wgsl */ `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let radius = fx.uEdge.x;
  let softness = fx.uEdge.y;
  let edge = smoothstep(radius, radius + softness, distance(uv, vec2(0.5)));
  return mix(sampleColor(uv), sampleColor2(uv), edge);
}
`,
  gl: /* glsl */ `
vec4 effect(vec2 uv) {
  float radius = uEdge.x;
  float softness = uEdge.y;
  float edge = smoothstep(radius, radius + softness, distance(uv, vec2(0.5)));
  return mix(sampleColor(uv), sampleColor2(uv), edge);
}
`,
};

export interface EdgeBlurEffectOptions extends PostEffectOptions {
  /** Where the blur starts, as a distance from the centre in `uv`. @default 0.2 */
  radius?: number;
  /** How far past `radius` the frame is fully blurred, in `uv`; above 0. @default 0.25 */
  softness?: number;
  /** How far the blur reaches each way, in CSS pixels. @default 12 */
  size?: number;
  /**
   * The blur textures' texels per CSS pixel, as `resolution` means on a pixi filter: 0.25 is a quarter of the view's
   * width and height. Fixed once built, since `build()` sizes the textures from it. @default 0.25
   */
  resolution?: number;
}

/**
 * Blurs the frame toward its edges, leaving the centre sharp
 *
 * The multi-pass kind of post effect: it overrides `build()` and adds its own passes to the render graph. Two blur
 * passes run in small textures it makes there, then a third mixes the blur in and writes the effect's result to
 * `io.output`. `radius`, `softness` and `size` are uniform writes, free every frame.
 */
export class EdgeBlurEffect extends PostEffect {
  /** The blur textures' texels per CSS pixel; `build()` sizes them from it, so it's fixed */
  public readonly resolution: number;
  /** One group per blur pass, so the two passes run one shader with a direction each */
  private readonly _across = new UniformGroup({ uBlur: { value: new Float32Array(2), type: 'vec2<f32>' } });
  private readonly _down = new UniformGroup({ uBlur: { value: new Float32Array(2), type: 'vec2<f32>' } });
  private readonly _edge = new UniformGroup({ uEdge: { value: new Float32Array(2), type: 'vec2<f32>' } });
  private _size = 0;

  constructor({ radius = 0.2, softness = 0.25, size = 12, resolution = 0.25, ...options }: EdgeBlurEffectOptions = {}) {
    super(options);
    // `size` is stored in blur texels at this resolution, so `resolution` is set first.
    this.resolution = resolution;
    this.radius = radius;
    this.softness = softness;
    this.size = size;
  }

  /**
   * Adds the effect's three passes. The result has to land in `io.output`, which is `null` when this effect is the
   * last one and draws to the screen. Handles are names here: they become textures only when the passes render.
   */
  public override build(graph: RenderGraph, io: EffectIO): void {
    const across = graph.createColor({ resolution: this.resolution, label: 'across' });
    const blurred = graph.createColor({ resolution: this.resolution, label: 'blurred' });
    const { renderer } = io;

    graph.addPass(
      new FullscreenPass({
        renderer,
        label: 'blurAcross',
        fragment: BLUR_FRAGMENT,
        uniforms: this._across,
        reads: { color: io.input },
        writes: across,
      }),
    );
    graph.addPass(
      new FullscreenPass({
        renderer,
        label: 'blurDown',
        fragment: BLUR_FRAGMENT,
        uniforms: this._down,
        reads: { color: across },
        writes: blurred,
      }),
    );
    graph.addPass(
      new FullscreenPass({
        renderer,
        label: 'edgeMix',
        fragment: MIX_FRAGMENT,
        uniforms: this._edge,
        reads: { color: io.input, color2: blurred },
        writes: io.output,
      }),
    );
  }

  /** Where the blur starts, in `uv` from the centre */
  public get radius(): number {
    return this._edge.uniforms.uEdge[0];
  }
  public set radius(value: number) {
    this.writeLane(this._edge, 'uEdge', 0, value);
  }

  /** How far past `radius` the frame is fully blurred */
  public get softness(): number {
    return this._edge.uniforms.uEdge[1];
  }
  public set softness(value: number) {
    this.writeLane(this._edge, 'uEdge', 1, value);
  }

  /** How far the blur reaches each way, in CSS pixels; it writes `uBlur` in both blur passes' groups */
  public get size(): number {
    return this._size;
  }
  public set size(value: number) {
    this._size = value;
    // Four taps reach out each side, `spread` blur texels apart, and a blur texel is 1 / resolution CSS pixels wide.
    this.writeLane(this._across, 'uBlur', 0, this.spread);
    this.writeLane(this._down, 'uBlur', 1, this.spread);
  }

  /** The gap between the blur's taps, in blur texels: what `uBlur` holds. Past about 2 the taps skip texels and band */
  public get spread(): number {
    return (this._size * this.resolution) / 4;
  }
}
