import { definedProps, UniformGroup } from 'pixi.js';

import type { RenderGraph } from '../../../core/render-graph/RenderGraph';
import { FullscreenPass } from '../../../post-processing/effects/FullscreenPass';
import { PostEffect } from '../../../post-processing/effects/PostEffect';
import type { EffectFragment, EffectIO, PostEffectOptions } from '../../../post-processing/effects/PostEffect';

/** The centre tap seeds the sum at weight 1, so a sky pixel ringed by sharp taps never divides by zero */
const TILT_FRAGMENT: EffectFragment = {
  gpu: /* wgsl */ `
const TS_TAPS: i32 = 16;
const TS_GOLDEN: f32 = 2.3999632;

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
  let viewStep = viewTexel();
  let lod = max(0.0, log2(radiusPx * viewStep.x / inputTexel().x / sqrt(f32(TS_TAPS))));
  var sum = sampleColorLod(uv, lod);
  var wsum = 1.0;
  for (var i = 0; i < TS_TAPS; i = i + 1) {
    let t = (f32(i) + 0.5) / f32(TS_TAPS);
    let a = f32(i) * TS_GOLDEN;
    let distPx = sqrt(t) * radiusPx;
    let tapUv = uv + vec2<f32>(cos(a), sin(a)) * distPx * viewStep;
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
const float TS_GOLDEN = 2.3999632;

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
  vec2 viewStep = viewTexel();
  float lod = max(0.0, log2(radiusPx * viewStep.x / inputTexel().x / sqrt(float(TS_TAPS))));
  vec4 sum = sampleColorLod(uv, lod);
  float wsum = 1.0;
  for (int i = 0; i < TS_TAPS; i++) {
    float t = (float(i) + 0.5) / float(TS_TAPS);
    float a = float(i) * TS_GOLDEN;
    float distPx = sqrt(t) * radiusPx;
    vec2 tapUv = uv + vec2(cos(a), sin(a)) * distPx * viewStep;
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
 * @example
 * ```ts
 * const options: TiltShiftEffectOptions = { focalDepth: 20, focalNear: 2, maxBlur: 16 };
 * view3d.passes = [new TiltShiftEffect(options)];
 * ```
 * @category extras:post-processing
 * @standard
 */
export interface TiltShiftEffectOptions extends PostEffectOptions {
  /**
   * Distance from the camera to the plane in focus, in world units
   *
   * The plane faces the camera, so it moves and turns with it.
   * @default 35
   * @example
   * ```ts
   * new TiltShiftEffect({ focalDepth: 20 });
   * ```
   */
  focalDepth?: number;
  /**
   * How far either side of the focal plane stays fully sharp, in world units
   *
   * Keep it below {@link TiltShiftEffectOptions#focalFar | focalFar}.
   * @default 3
   * @example
   * ```ts
   * new TiltShiftEffect({ focalNear: 1 });
   * ```
   */
  focalNear?: number;
  /**
   * Distance from the focal plane at which the blur is strongest, in world units
   * @default 14
   * @example
   * ```ts
   * new TiltShiftEffect({ focalFar: 6 });
   * ```
   */
  focalFar?: number;
  /**
   * Blur radius at full strength, in physical pixels on screen
   * @default 12
   * @example
   * ```ts
   * new TiltShiftEffect({ maxBlur: 20 });
   * ```
   */
  maxBlur?: number;
  /**
   * Whether to paint the focus settings instead of blurring; {@link TiltShiftEffect#debug} has the colour key
   * @default false
   * @example
   * ```ts
   * new TiltShiftEffect({ debug: true });
   * ```
   */
  debug?: boolean;
}

/**
 * Tilt-shift: a miniature look from a narrow depth of field
 *
 * A thin band of depth stays sharp and everything in front of and behind it blurs, the way a
 * macro lens sees a close-up, so a full-size scene reads as a tiny model. A high, angled camera
 * sells it best.
 *
 * One pass, but its input needs mipmaps, which cost a mipmap generation each frame and a third
 * more memory. Every property can change every frame.
 * @example
 * ```ts
 * view.passes = [new TiltShiftEffect({ focalDepth: 35, maxBlur: 12 })];
 * ```
 * @category extras:post-processing
 * @standard
 */
export class TiltShiftEffect extends PostEffect {
  /**
   * Defaults for every new `TiltShiftEffect`; an option passed as `undefined` keeps its default
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

  /**
   * Always `true`: the blur reads coarse mip levels of its input
   * @advanced
   */
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
   * Adds the blur pass for this slot in the chain
   * @param graph - Render graph being built.
   * @param io - Input/output handles for this slot in the chain.
   * @example
   * ```ts
   * const focused = graph.createColor({ label: 'focused' });
   * tiltShift.build(graph, { ...io, output: focused });
   * ```
   * @advanced
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

  /**
   * Distance from the camera to the plane in focus, in world units
   * @example
   * ```ts
   * tiltShift.focalDepth = 20 + Math.sin(time) * 5;
   * ```
   */
  public get focalDepth(): number {
    return this._uniforms.uniforms.uFocus[0];
  }
  /**
   * Sets the distance to the plane in focus
   * @param value - Distance from the camera to the focal plane, in world units.
   */
  public set focalDepth(value: number) {
    this.writeLane(this._uniforms, 'uFocus', 0, value);
  }

  /**
   * How far either side of the focal plane stays fully sharp, in world units
   * @example
   * ```ts
   * tiltShift.focalNear = 1;
   * ```
   */
  public get focalNear(): number {
    return this._uniforms.uniforms.uFocus[1];
  }
  /**
   * Sets how far either side of the focal plane stays fully sharp
   * @param value - Distance from the focal plane, in world units.
   */
  public set focalNear(value: number) {
    this.writeLane(this._uniforms, 'uFocus', 1, value);
  }

  /**
   * Distance from the focal plane at which the blur is strongest, in world units
   * @example
   * ```ts
   * tiltShift.focalFar = 6;
   * ```
   */
  public get focalFar(): number {
    return this._uniforms.uniforms.uFocus[2];
  }
  /**
   * Sets the distance from the focal plane at which the blur is strongest
   * @param value - Distance from the focal plane, in world units.
   */
  public set focalFar(value: number) {
    this.writeLane(this._uniforms, 'uFocus', 2, value);
  }

  /**
   * Blur radius at full strength, in physical pixels on screen
   * @example
   * ```ts
   * tiltShift.maxBlur = 20;
   * ```
   */
  public get maxBlur(): number {
    return this._uniforms.uniforms.uFocus[3];
  }
  /**
   * Sets the blur radius at full strength
   * @param value - Radius in physical pixels on screen.
   */
  public set maxBlur(value: number) {
    this.writeLane(this._uniforms, 'uFocus', 3, value);
  }

  /**
   * Whether to paint the focus settings instead of blurring, to tune them by eye
   *
   * Over a dimmed grey copy of the frame, a white line marks the focal plane and green the sharp
   * band. Blurred areas shift toward orange in front of the plane and blue behind it, more so the
   * stronger the blur.
   * @example
   * ```ts
   * tiltShift.debug = true;
   * ```
   */
  public get debug(): boolean {
    return this._uniforms.uniforms.uTilt[0] > 0.5;
  }
  /**
   * Sets whether to paint the focus settings
   * @param value - `true` to paint them instead of blurring.
   */
  public set debug(value: boolean) {
    this.writeLane(this._uniforms, 'uTilt', 0, value ? 1 : 0);
  }
}
