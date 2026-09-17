import { Color, definedProps, UniformGroup } from 'pixi.js';
import type { ColorSource } from 'pixi.js';

import { PostEffect } from '../../../post-processing/effects/PostEffect';
import type { EffectFragment, PostEffectOptions } from '../../../post-processing/effects/PostEffect';

/**
 * Constructor options for {@link TintEffect}
 * @category extras:post-processing
 * @standard
 */
export interface TintEffectOptions extends PostEffectOptions {
  /**
   * Multiplier colour
   * @default 0xffffff
   */
  tint?: ColorSource;
}

/**
 * Multiplies the frame by a flat colour
 *
 * The simplest possible transform effect, and the reference for authoring one: a fragment
 * against the standard header, a uniform group, and plain property accessors.
 *
 * The multiply happens in the frame's display-encoded space (post tone-mapping), matching
 * the `Container.tint` mental model.
 * @example
 * ```ts
 * view.passes = [new TintEffect({ tint: 0xff8888 })];
 * ```
 * @category extras:post-processing
 * @standard
 */
export class TintEffect extends PostEffect {
  /**
   * Default {@link TintEffectOptions} merged under every constructor call
   *
   * `new TintEffect(opts)` resolves as `{ ...TintEffect.defaultOptions, ...opts }`. Mutate to change defaults
   * process-wide.
   * @example
   * ```ts
   * TintEffect.defaultOptions.tint = 0xffd9b3;
   * ```
   */
  public static defaultOptions: TintEffectOptions = {
    tint: 0xffffff,
  };

  protected override readonly uniforms = new UniformGroup({
    uTint: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
  });

  protected readonly fragment: EffectFragment = {
    gpu: /* wgsl */ `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  return sampleColor(uv) * fx.uTint;
}
`,
    gl: /* glsl */ `
vec4 effect(vec2 uv) {
  return sampleColor(uv) * uTint;
}
`,
  };

  private _tint = 0;

  constructor(options: TintEffectOptions = {}) {
    const { tint, ...rest } = { ...TintEffect.defaultOptions, ...definedProps(options) };

    super(rest);
    this.tint = tint!;
  }

  /** Multiplier colour — set any {@link ColorSource}, read back the canonical hex */
  public get tint(): number {
    return this._tint;
  }

  /**
   * Sets the multiplier colour, writing the unpacked lanes straight into the uniform group
   * @param value - Colour to multiply the frame by; its alpha is ignored
   */
  public set tint(value: ColorSource) {
    const color = Color.shared.setValue(value);
    this._tint = color.toNumber();

    const lanes = this.uniforms.uniforms.uTint as Float32Array;
    lanes[0] = color.red;
    lanes[1] = color.green;
    lanes[2] = color.blue;
    this.uniforms.update();
  }
}
