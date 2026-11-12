import { definedProps, UniformGroup } from 'pixi.js';

import type { RenderGraph } from '../../../core/render-graph/RenderGraph';
import { FullscreenPass } from '../../../post-processing/effects/FullscreenPass';
import { PostEffect } from '../../../post-processing/effects/PostEffect';
import type { EffectFragment, EffectIO, PostEffectOptions } from '../../../post-processing/effects/PostEffect';
import { velocityOutput } from '../../scene-outputs/velocityOutput';

const MOTION_BLUR_FRAGMENT: EffectFragment = {
  gpu: /* wgsl */ `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  var velocity = sampleColor2(uv).xy * fx.uBlur.x;
  let pixels = length(velocity / viewTexel());
  if (pixels < 0.5) { return sampleColor(uv); }
  velocity = velocity * min(1.0, fx.uBlur.z / pixels);

  let fc = uv / texel();
  let offset = fract(52.9829189 * fract(dot(fc, vec2<f32>(0.06711056, 0.00583715))));
  let count = i32(fx.uBlur.y);
  var sum = vec4<f32>(0.0);
  for (var i = 0; i < count; i = i + 1) {
    let t = (f32(i) + offset) / fx.uBlur.y - 0.5;
    sum += sampleColor(uv - velocity * t);
  }
  return sum / fx.uBlur.y;
}
`,
  gl: /* glsl */ `
vec4 effect(vec2 uv) {
  vec2 velocity = sampleColor2(uv).xy * uBlur.x;
  float pixels = length(velocity / viewTexel());
  if (pixels < 0.5) { return sampleColor(uv); }
  velocity *= min(1.0, uBlur.z / pixels);

  vec2 fc = uv / texel();
  float offset = fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
  vec4 sum = vec4(0.0);
  for (int i = 0; i < int(uBlur.y); i++) {
    float t = (float(i) + offset) / uBlur.y - 0.5;
    sum += sampleColor(uv - velocity * t);
  }
  return sum / uBlur.y;
}
`,
};

/**
 * Constructor options for {@link MotionBlurEffect}
 * @example
 * ```ts
 * const options: MotionBlurEffectOptions = { intensity: 1, samples: 16 };
 * view3d.passes = [new MotionBlurEffect(options)];
 * ```
 * @category extras:post-processing
 * @standard
 */
export interface MotionBlurEffectOptions extends PostEffectOptions {
  /**
   * How much of a frame's motion each streak covers
   *
   * `0.5` is a film camera's shutter, open for half of each frame. `1` streaks across the whole
   * frame's motion, and more than 1 exaggerates it.
   * @default 0.5
   * @example
   * ```ts
   * new MotionBlurEffect({ intensity: 1 });
   * ```
   */
  intensity?: number;
  /**
   * Taps per pixel along the streak; the cost of the pass grows with it
   * @default 12
   * @example
   * ```ts
   * new MotionBlurEffect({ samples: 8 });
   * ```
   */
  samples?: number;
  /**
   * Longest streak, in physical pixels on screen; longer ones are scaled down to it
   *
   * Keeps a sudden spin from smearing too far or breaking into separate copies between taps.
   * @default 48
   * @example
   * ```ts
   * new MotionBlurEffect({ maxLength: 24 });
   * ```
   */
  maxLength?: number;
}

/**
 * Blurs the image along the direction each pixel moved since the camera's previous render
 *
 * Only the camera's motion counts: turning or moving the camera streaks opaque meshes, though not the
 * view's background, an object moving in front of a still camera stays sharp, and one that moves
 * with the camera, such as a cockpit, streaks with the scene. Each streak is measured per rendered
 * frame, so it shortens as the frame rate rises, as a real camera's does. The effect reads
 * {@link velocityOutput}, which notes the surfaces that have no velocity of their own, such as
 * blended ones.
 *
 * On a camera cut, such as a teleport or a change of shot, call {@link Camera3D#resetHistory} so
 * the first frame of the new shot isn't smeared by the jump. Every property can change every frame.
 * @example
 * ```ts
 * view.passes = [new MotionBlurEffect({ intensity: 0.75 })];
 * ```
 * @category extras:post-processing
 * @standard
 */
export class MotionBlurEffect extends PostEffect {
  /**
   * Defaults for every new `MotionBlurEffect`; an option passed as `undefined` keeps its default
   * @example
   * ```ts
   * MotionBlurEffect.defaultOptions.samples = 8;
   * ```
   */
  public static defaultOptions: MotionBlurEffectOptions = {
    intensity: 0.5,
    samples: 12,
    maxLength: 48,
  };

  /** Always `[velocityOutput]`, so the view writes the velocity while the effect is enabled */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- fixed by the effect; the view reads it, users don't
  public override readonly requiredOutputs = [velocityOutput];

  protected override readonly uniforms = new UniformGroup({
    uBlur: { value: new Float32Array(4), type: 'vec4<f32>' },
  });

  constructor(options: MotionBlurEffectOptions = {}) {
    const { intensity, samples, maxLength, ...rest } = {
      ...MotionBlurEffect.defaultOptions,
      ...definedProps(options),
    };

    super(rest);
    this.intensity = intensity!;
    this.samples = samples!;
    this.maxLength = maxLength!;
  }

  /**
   * Adds the blur pass for this slot in the chain
   * @param graph - Render graph being built.
   * @param io - Input/output handles for this slot in the chain.
   * @example
   * ```ts
   * const blurred = graph.createColor({ label: 'blurred' });
   * motionBlur.build(graph, { ...io, output: blurred });
   * ```
   * @advanced
   */
  public override build(graph: RenderGraph, io: EffectIO): void {
    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'MotionBlurEffect',
        fragment: MOTION_BLUR_FRAGMENT,
        uniforms: this.uniforms,
        reads: { color: io.input, color2: graph.getSceneOutput(velocityOutput) },
        writes: io.output,
      }),
    );
  }

  /**
   * How much of a frame's motion each streak covers; `0.5` is a film camera's shutter
   * @example
   * ```ts
   * motionBlur.intensity = 1;
   * ```
   */
  public get intensity(): number {
    return (this.uniforms.uniforms.uBlur as Float32Array)[0];
  }
  /**
   * Sets how much of a frame's motion each streak covers
   * @param value - Fraction of the frame's motion; above 1 exaggerates it.
   */
  public set intensity(value: number) {
    this.writeLane(this.uniforms, 'uBlur', 0, value);
  }

  /**
   * Taps per pixel along the streak; the cost of the pass grows with it
   * @example
   * ```ts
   * motionBlur.samples = isMobile ? 6 : 12;
   * ```
   */
  public get samples(): number {
    return (this.uniforms.uniforms.uBlur as Float32Array)[1];
  }
  /**
   * Sets the taps per pixel
   * @param value - Taps along each streak, rounded, at least 1.
   */
  public set samples(value: number) {
    this.writeLane(this.uniforms, 'uBlur', 1, Math.max(1, Math.round(value)));
  }

  /**
   * Longest streak, in physical pixels on screen; longer ones are scaled down to it
   * @example
   * ```ts
   * motionBlur.maxLength = 24;
   * ```
   */
  public get maxLength(): number {
    return (this.uniforms.uniforms.uBlur as Float32Array)[2];
  }
  /**
   * Sets the longest streak
   * @param value - Length in physical pixels on screen.
   */
  public set maxLength(value: number) {
    this.writeLane(this.uniforms, 'uBlur', 2, value);
  }
}
