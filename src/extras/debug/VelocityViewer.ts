import { definedProps, UniformGroup } from 'pixi.js';

import type { RenderGraph } from '../../core/render-graph/RenderGraph';
import { FullscreenPass } from '../../post-processing/effects/FullscreenPass';
import { PostEffect } from '../../post-processing/effects/PostEffect';
import type { EffectFragment, EffectIO, PostEffectOptions } from '../../post-processing/effects/PostEffect';
import { velocityOutput } from '../scene-outputs/velocityOutput';

/**
 * `sign(uFxClip.w)` is positive when `v` runs up the image, so it makes the velocity up-positive;
 * a still pixel takes direction `(1, 0)`, since `atan2(0, 0)` is undefined
 */
const VELOCITY_FRAGMENT: EffectFragment = {
  gpu: /* wgsl */ `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let velocity = sampleColor(uv).xy;
  let up = sign(fxh.uFxClip.w);
  let pixels = vec2<f32>(velocity.x, velocity.y * up) / texel();
  let speed = length(pixels);
  let direction = select(pixels, vec2<f32>(1.0, 0.0), speed <= 1e-6);
  let hue = atan2(direction.y, direction.x) * 0.15915494;
  let rgb = clamp(abs(fract(hue + vec3<f32>(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(rgb * min(speed * fx.uVelocityScale, 1.0), 1.0);
}
`,
  gl: /* glsl */ `
vec4 effect(vec2 uv) {
  vec2 velocity = sampleColor(uv).xy;
  float up = sign(uFxClip.w);
  vec2 pixels = vec2(velocity.x, velocity.y * up) / texel();
  float speed = length(pixels);
  vec2 direction = mix(pixels, vec2(1.0, 0.0), step(speed, 1e-6));
  float hue = atan(direction.y, direction.x) * 0.15915494;
  vec3 rgb = clamp(abs(fract(hue + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return vec4(rgb * min(speed * uVelocityScale, 1.0), 1.0);
}
`,
};

/**
 * Constructor options for {@link VelocityViewer}
 * @example
 * ```ts
 * const viewer = new VelocityViewer({ scale: 0.5, enabled: false });
 * view3d.passes = [viewer];
 * ```
 * @category extras:debug
 * @advanced
 */
export interface VelocityViewerOptions extends PostEffectOptions {
  /**
   * Brightness each pixel of motion adds; see {@link VelocityViewer#scale}
   * @default 0.25
   */
  scale?: number;
}

/**
 * Debug effect that shows the scene's velocity in place of the image
 *
 * Each pixel's hue is the direction its surface moved on screen since the camera's previous
 * render: red is right, yellow-green up, cyan left and violet down. Brightness is the speed; raise
 * {@link VelocityViewer#scale | scale} to see small motions. The velocity comes from the camera's
 * motion alone, so with a still camera every pixel is black, moving objects included. The
 * background is black, and blended and transmissive surfaces show the motion of what's behind
 * them; {@link velocityOutput} lists what else writes no velocity.
 *
 * The view writes velocity only while an enabled pass needs it, so the viewer costs nothing while
 * disabled or left out of {@link View3D#passes}.
 *
 * It runs after tone mapping by default, so the tone curve leaves its colours alone. It replaces
 * the image, so effects before it drop out of the frame and effects after it treat the velocity
 * colours as their input; put it last in `passes`.
 * @example
 * ```ts
 * const viewer = new VelocityViewer({ scale: 0.5 });
 * view3d.passes = [viewer];
 *
 * window.addEventListener('keydown', (e) => {
 *   if (e.key === 'v') viewer.enabled = !viewer.enabled;
 * });
 * ```
 * @category extras:debug
 * @advanced
 */
export class VelocityViewer extends PostEffect {
  /**
   * Defaults for every new `VelocityViewer`; an option passed as `undefined` keeps its default
   * @example
   * ```ts
   * VelocityViewer.defaultOptions.scale = 1;
   * ```
   */
  public static defaultOptions: VelocityViewerOptions = {
    stage: 'afterToneMapping',
    scale: 0.25,
  };

  /** Makes the view write {@link velocityOutput} while the viewer is enabled */
  public override readonly requiredOutputs = [velocityOutput];

  protected override readonly uniforms = new UniformGroup({
    uVelocityScale: { value: 0, type: 'f32' },
  });

  constructor(options: VelocityViewerOptions = {}) {
    const { scale, ...rest } = { ...VelocityViewer.defaultOptions, ...definedProps(options) };

    super(rest);
    this.scale = scale!;
  }

  /**
   * Brightness each pixel of motion adds
   *
   * A surface that moves `1 / scale` pixels of the rendered image between two renders shows at full
   * brightness, and faster ones clamp there, so the default of 0.25 saturates at 4 pixels.
   * @example
   * ```ts
   * const viewer = new VelocityViewer();
   * viewer.scale = 2;
   * ```
   */
  public get scale(): number {
    return this.uniforms.uniforms.uVelocityScale;
  }

  /**
   * Sets the brightness each pixel of motion adds
   * @param value - Brightness per pixel; 1 saturates at one pixel
   */
  public set scale(value: number) {
    this.uniforms.uniforms.uVelocityScale = value;
    this.uniforms.update();
  }

  /**
   * Adds the pass that draws the velocity in place of the chain's image
   * @param graph - Render graph being built
   * @param io - This effect's place in the chain; `io.input` goes unread
   * @advanced
   */
  public override build(graph: RenderGraph, io: EffectIO): void {
    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'VelocityViewer',
        fragment: VELOCITY_FRAGMENT,
        uniforms: this.uniforms,
        reads: { color: graph.getSceneOutput(velocityOutput) },
        writes: io.output,
      }),
    );
  }
}
