import { Color, definedProps, UniformGroup } from 'pixi.js';
import type { ColorSource } from 'pixi.js';

import { PostEffect } from '../../../post-processing/effects/PostEffect';
import type { EffectFragment, PostEffectOptions } from '../../../post-processing/effects/PostEffect';

/**
 * Constructor options for {@link TintEffect}
 * @example
 * ```ts
 * const options: TintEffectOptions = { tint: 'skyblue', enabled: false };
 * view3d.passes = [new TintEffect(options)];
 * ```
 * @category extras:post-processing
 * @standard
 */
export interface TintEffectOptions extends PostEffectOptions {
  /**
   * Colour the frame is multiplied by; its alpha is ignored
   * @default 0xffffff
   * @example
   * ```ts
   * new TintEffect({ tint: 0xff8888 });
   * ```
   */
  tint?: ColorSource;
}

/**
 * Multiplies the frame by a flat colour
 *
 * By default it tints the finished picture, after the tone curve, as `Container.tint` does in 2D.
 * With `stage: 'beforeToneMapping'` it tints the scene's light instead.
 * @example
 * ```ts
 * view.passes = [new TintEffect({ tint: 0xff8888 })];
 * ```
 * @category extras:post-processing
 * @standard
 */
export class TintEffect extends PostEffect {
  /**
   * Defaults for every new `TintEffect`; an option passed as `undefined` keeps its default
   * @example
   * ```ts
   * TintEffect.defaultOptions.tint = 0xffd9b3;
   * ```
   */
  public static defaultOptions: TintEffectOptions = {
    stage: 'afterToneMapping',
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

  /**
   * Colour the frame is multiplied by
   *
   * Takes any {@link ColorSource} and reads back as a hex number.
   * @example
   * ```ts
   * const effect = new TintEffect();
   * effect.tint = 'red';
   * const hex = effect.tint; // 0xff0000
   * ```
   */
  public get tint(): number {
    return this._tint;
  }

  /**
   * Sets the colour the frame is multiplied by
   * @param value - Any colour; its alpha is ignored.
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
