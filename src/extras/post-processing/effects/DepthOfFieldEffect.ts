import { definedProps, isMobile, UniformGroup } from 'pixi.js';

import type { RenderGraph } from '../../../core/render-graph/RenderGraph';
import { FullscreenPass } from '../../../post-processing/effects/FullscreenPass';
import { PostEffect } from '../../../post-processing/effects/PostEffect';
import type { EffectFragment, EffectIO, PostEffectOptions } from '../../../post-processing/effects/PostEffect';

/** `dofDebug` takes the frame's colour as `base`, since the blur reads it as `sampleColor` and the merge as `sampleColor2` */
const DOF_ZONES: EffectFragment = {
  gpu: /* wgsl */ `
fn dofAmount(lz: f32) -> f32 {
  let range = fx.uDof.y;
  let t = clamp((abs(lz - fx.uDof.x) - range) / max(fx.uDof.z, 0.0001), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn dofDebug(uv: vec2<f32>, base: vec3<f32>) -> vec4<f32> {
  let lz = linearDepth(sampleDepth(uv));
  let s = lz - fx.uDof.x;
  let grey = dot(base, vec3<f32>(0.299, 0.587, 0.114));
  let blurred = select(vec3<f32>(0.3, 0.55, 1.0), vec3<f32>(1.0, 0.45, 0.2), s < 0.0);
  let zone = mix(vec3<f32>(0.25, 1.0, 0.45), blurred, dofAmount(lz));
  let line = 1.0 - smoothstep(0.0, (fx.uDof.y + fx.uDof.z) * 0.02 + 0.02, abs(s));
  return vec4<f32>(mix(mix(vec3<f32>(grey * 0.4), zone, 0.55), vec3<f32>(1.0), line * 0.9), 1.0);
}
`,
  gl: /* glsl */ `
float dofAmount(float lz) {
  float range = uDof.y;
  float t = clamp((abs(lz - uDof.x) - range) / max(uDof.z, 0.0001), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

vec4 dofDebug(vec2 uv, vec3 base) {
  float lz = linearDepth(sampleDepth(uv));
  float s = lz - uDof.x;
  float grey = dot(base, vec3(0.299, 0.587, 0.114));
  vec3 blurred = s < 0.0 ? vec3(1.0, 0.45, 0.2) : vec3(0.3, 0.55, 1.0);
  vec3 zone = mix(vec3(0.25, 1.0, 0.45), blurred, dofAmount(lz));
  float line = 1.0 - smoothstep(0.0, (uDof.y + uDof.z) * 0.02 + 0.02, abs(s));
  return vec4(mix(mix(vec3(grey * 0.4), zone, 0.55), vec3(1.0), line * 0.9), 1.0);
}
`,
};

/**
 * A tap behind this pixel takes this pixel's radius, or what is behind would smear over sharp edges. Colour and
 * alpha share every weight, or the output stops being premultiplied over a transparent background. Every read of
 * colour lands on a texel centre, since a filtered read would carry a sharp edge's colour past the depth it was read
 * with.
 */
function dofBlurFragment(taps: number): EffectFragment {
  return {
    gpu: /* wgsl */ `${DOF_ZONES.gpu}
const DOF_TAPS: i32 = ${taps};
const DOF_GOLDEN: vec2<f32> = vec2<f32>(-0.7373688, 0.6754903);

fn effect(uv: vec2<f32>) -> vec4<f32> {
  let snap = inputTexel();
  let cuv = (floor(uv / snap) + 0.5) * snap;
  if (fx.uDofView.x > 0.5) { return dofDebug(cuv, sampleColor(cuv).rgb); }
  let px = viewTexel();
  let reach = fx.uDof.w;
  let cz = linearDepth(sampleDepth(cuv));
  let cr = dofAmount(cz) * reach;
  let cw = 1.0 / max(3.14159265 * cr * cr, 1.0);
  var sum = sampleColor(cuv) * cw;
  var wsum = cw;
  let cell = floor(uv / texel());
  let turn = fract(52.9829189 * fract(dot(cell, vec2<f32>(0.06711056, 0.00583715)))) * 6.2831853;
  var dir = vec2<f32>(cos(turn), sin(turn));
  let area = 2.0 * reach / f32(DOF_TAPS);
  for (var i = 0; i < DOF_TAPS; i = i + 1) {
    let d = (f32(i) + 0.5) / f32(DOF_TAPS) * reach;
    let tuv = (floor((cuv + dir * d * px) / snap) + 0.5) * snap;
    let tz = linearDepth(sampleDepth(tuv));
    let tr = select(dofAmount(tz) * reach, cr, tz > cz);
    let w = clamp(tr - d + 0.5, 0.0, 1.0) * area * d / max(3.14159265 * tr * tr, 1.0);
    sum = sum + sampleColor(tuv) * w;
    wsum = wsum + w;
    dir = vec2<f32>(dir.x * DOF_GOLDEN.x - dir.y * DOF_GOLDEN.y, dir.x * DOF_GOLDEN.y + dir.y * DOF_GOLDEN.x);
  }
  return sum / wsum;
}
`,
    gl: /* glsl */ `${DOF_ZONES.gl}
const int DOF_TAPS = ${taps};
const vec2 DOF_GOLDEN = vec2(-0.7373688, 0.6754903);

vec4 effect(vec2 uv) {
  vec2 snap = inputTexel();
  vec2 cuv = (floor(uv / snap) + 0.5) * snap;
  if (uDofView.x > 0.5) { return dofDebug(cuv, sampleColor(cuv).rgb); }
  vec2 px = viewTexel();
  float reach = uDof.w;
  float cz = linearDepth(sampleDepth(cuv));
  float cr = dofAmount(cz) * reach;
  float cw = 1.0 / max(3.14159265 * cr * cr, 1.0);
  vec4 sum = sampleColor(cuv) * cw;
  float wsum = cw;
  vec2 cell = floor(uv / texel());
  float turn = fract(52.9829189 * fract(dot(cell, vec2(0.06711056, 0.00583715)))) * 6.2831853;
  vec2 dir = vec2(cos(turn), sin(turn));
  float area = 2.0 * reach / float(DOF_TAPS);
  for (int i = 0; i < DOF_TAPS; i++) {
    float d = (float(i) + 0.5) / float(DOF_TAPS) * reach;
    vec2 tuv = (floor((cuv + dir * d * px) / snap) + 0.5) * snap;
    float tz = linearDepth(sampleDepth(tuv));
    float tr = tz > cz ? cr : dofAmount(tz) * reach;
    float w = clamp(tr - d + 0.5, 0.0, 1.0) * area * d / max(3.14159265 * tr * tr, 1.0);
    sum += sampleColor(tuv) * w;
    wsum += w;
    dir = vec2(dir.x * DOF_GOLDEN.x - dir.y * DOF_GOLDEN.y, dir.x * DOF_GOLDEN.y + dir.y * DOF_GOLDEN.x);
  }
  return sum / wsum;
}
`,
  };
}

/**
 * Brings the half-resolution blur back to full size. Its four nearest texels count by how close their depth is to
 * this pixel's, or blur from across a sharp edge would bleed over it. A sharp pixel keeps its own colour and adds
 * what the blur changed at those texels, which is where a blurred foreground spreads over it. `sampleColor` is the
 * blur and `sampleColor2` the frame; each texel's frame colour is read where the blur read its centre.
 */
const DOF_MERGE: EffectFragment = {
  gpu: /* wgsl */ `${DOF_ZONES.gpu}
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let frame = sampleColor2(uv);
  if (fx.uDofView.x > 0.5) { return dofDebug(uv, frame.rgb); }
  let lowTexel = inputTexel();
  let sceneTexel = depthTexel();
  let z = linearDepth(sampleDepth(uv));
  let p = uv / lowTexel - 0.5;
  let corner = floor(p);
  let f = p - corner;
  var blurSum = vec4<f32>(0.0);
  var frameSum = vec4<f32>(0.0);
  var wsum = 0.0;
  for (var k = 0; k < 4; k = k + 1) {
    let o = vec2<f32>(f32(k & 1), f32(k >> 1u));
    let c = (corner + o + 0.5) * lowTexel;
    let s = (floor(c / sceneTexel) + 0.5) * sceneTexel;
    let near = clamp(1.0 - abs(linearDepth(sampleDepth(s)) - z) / z * 20.0, 0.001, 1.0);
    let w = mix(1.0 - f.x, f.x, o.x) * mix(1.0 - f.y, f.y, o.y) * near;
    blurSum = blurSum + sampleColor(c) * w;
    frameSum = frameSum + sampleColor2(s) * w;
    wsum = wsum + w;
  }
  let blurred = blurSum / wsum;
  let blurAmount = clamp(dofAmount(z) * fx.uDof.w - 0.5, 0.0, 1.0);
  return mix(max(frame + blurred - frameSum / wsum, vec4<f32>(0.0)), blurred, blurAmount);
}
`,
  gl: /* glsl */ `${DOF_ZONES.gl}
vec4 effect(vec2 uv) {
  vec4 frame = sampleColor2(uv);
  if (uDofView.x > 0.5) { return dofDebug(uv, frame.rgb); }
  vec2 lowTexel = inputTexel();
  vec2 sceneTexel = depthTexel();
  float z = linearDepth(sampleDepth(uv));
  vec2 p = uv / lowTexel - 0.5;
  vec2 corner = floor(p);
  vec2 f = p - corner;
  vec4 blurSum = vec4(0.0);
  vec4 frameSum = vec4(0.0);
  float wsum = 0.0;
  for (int k = 0; k < 4; k++) {
    vec2 o = vec2(float(k & 1), float(k >> 1));
    vec2 c = (corner + o + 0.5) * lowTexel;
    vec2 s = (floor(c / sceneTexel) + 0.5) * sceneTexel;
    float near = clamp(1.0 - abs(linearDepth(sampleDepth(s)) - z) / z * 20.0, 0.001, 1.0);
    float w = mix(1.0 - f.x, f.x, o.x) * mix(1.0 - f.y, f.y, o.y) * near;
    blurSum += sampleColor(c) * w;
    frameSum += sampleColor2(s) * w;
    wsum += w;
  }
  vec4 blurred = blurSum / wsum;
  float blurAmount = clamp(dofAmount(z) * uDof.w - 0.5, 0.0, 1.0);
  return mix(max(frame + blurred - frameSum / wsum, vec4(0.0)), blurred, blurAmount);
}
`,
};

const DOF_BLUR: Record<'high' | 'low', EffectFragment> = {
  high: dofBlurFragment(48),
  low: dofBlurFragment(16),
};

/**
 * Constructor options for {@link DepthOfFieldEffect}
 * @example
 * ```ts
 * const options: DepthOfFieldEffectOptions = { focusDistance: 8, focusRange: 1, focusFalloff: 3, maxBlur: 16 };
 * view3d.passes = [new DepthOfFieldEffect(options)];
 * ```
 * @category extras:post-processing
 * @standard
 */
export interface DepthOfFieldEffectOptions extends PostEffectOptions {
  /**
   * Depth in front of the camera that is in focus, in world units
   *
   * A depth along the camera's view, not a straight-line distance, so the sharp zone is a plane facing the camera.
   * @default 10
   * @example
   * ```ts
   * new DepthOfFieldEffect({ focusDistance: 6 });
   * ```
   */
  focusDistance?: number;
  /**
   * How far either side of {@link DepthOfFieldEffectOptions#focusDistance | focusDistance} stays fully sharp, in
   * world units
   *
   * Past it the blur grows over {@link DepthOfFieldEffectOptions#focusFalloff | focusFalloff}.
   * @default 1
   * @example
   * ```ts
   * new DepthOfFieldEffect({ focusRange: 0.5 });
   * ```
   */
  focusRange?: number;
  /**
   * How far past {@link DepthOfFieldEffectOptions#focusRange | focusRange} the blur takes to reach
   * {@link DepthOfFieldEffectOptions#maxBlur | maxBlur}, in world units
   *
   * A long falloff blurs gradually, as a real lens does, and suits the tilt-shift look; a short one makes a hard step
   * from sharp to blurred.
   * @default 3
   * @example
   * ```ts
   * new DepthOfFieldEffect({ focusRange: 1.5, focusFalloff: 5.5 });
   * ```
   */
  focusFalloff?: number;
  /**
   * Blur radius at full strength, in physical pixels on screen
   *
   * Multiply by `renderer.resolution` for the same look on a 2× screen. The shader takes the same number of taps at
   * any radius, so a larger radius looks grainier, not slower.
   * @default 12
   * @example
   * ```ts
   * new DepthOfFieldEffect({ maxBlur: 20 });
   * ```
   */
  maxBlur?: number;
  /**
   * How many taps the blur takes per pixel; fixed at construction
   *
   * - `'high'`: 48 taps at the scene's resolution, smooth at any blur radius.
   * - `'low'`: 16 taps at half the screen's resolution, then merged back at full size; about a sixth of the cost,
   *   and large blurs look grainy.
   * - `'auto'`: `'low'` on phones and tablets, as pixi's `isMobile.any` reports them, and `'high'` elsewhere.
   * @default 'auto'
   * @example
   * ```ts
   * new DepthOfFieldEffect({ quality: 'low' });
   * ```
   */
  quality?: 'auto' | 'high' | 'low';
  /**
   * Whether to paint the focus zones instead of blurring; {@link DepthOfFieldEffect#debug} has the colour key
   * @default false
   * @example
   * ```ts
   * new DepthOfFieldEffect({ debug: true });
   * ```
   */
  debug?: boolean;
}

/**
 * Depth of field: the scene is sharp at one depth and blurs in front of it and behind it, as through a camera lens
 *
 * Sharp edges stay sharp against a blurred background, and a blurred foreground spreads over what is behind it.
 * Over a view with no background, blurred edges fade to transparent, so the effect composites over the page. A
 * narrow sharp zone seen from a high, angled camera makes a full-size scene read as a miniature, the tilt-shift look.
 *
 * At `quality: 'high'` it is one pass at the scene's resolution; at `'low'`, which `'auto'` picks on phones, it blurs
 * at half the screen's resolution and merges back at full size. On a 2022 mid-range phone at 1920 × 1080 it took
 * about 26 ms a frame at `'high'` and 4.6 ms at `'low'`. It needs a perspective camera. Every property but `quality` can change every frame, so a focus that
 * follows a target costs a uniform write.
 * @example
 * ```ts
 * view.passes = [new DepthOfFieldEffect({ focusDistance: 8, focusRange: 1, maxBlur: 16 })];
 * ```
 * @category extras:post-processing
 * @standard
 */
export class DepthOfFieldEffect extends PostEffect {
  /**
   * Defaults for every new `DepthOfFieldEffect`; an option passed as `undefined` keeps its default
   * @example
   * ```ts
   * DepthOfFieldEffect.defaultOptions.maxBlur = 8;
   * ```
   */
  public static defaultOptions: DepthOfFieldEffectOptions = {
    focusDistance: 10,
    focusRange: 1,
    focusFalloff: 3,
    maxBlur: 12,
    quality: 'auto',
    debug: false,
  };

  /**
   * The taps per pixel this effect uses, with `'auto'` already resolved for this device
   * @example
   * ```ts
   * const effect = new DepthOfFieldEffect();
   * console.log(effect.quality); // 'low' on a phone
   * ```
   */
  public readonly quality: 'high' | 'low';

  protected override readonly uniforms = new UniformGroup({
    uDof: { value: new Float32Array(4), type: 'vec4<f32>' },
    uDofView: { value: new Float32Array(4), type: 'vec4<f32>' },
  });

  protected override readonly fragment: EffectFragment;

  constructor(options: DepthOfFieldEffectOptions = {}) {
    const { focusDistance, focusRange, focusFalloff, maxBlur, quality, debug, ...rest } = {
      ...DepthOfFieldEffect.defaultOptions,
      ...definedProps(options),
    };

    super(rest);

    this.quality = quality === 'auto' ? (isMobile.any ? 'low' : 'high') : quality!;
    this.fragment = DOF_BLUR[this.quality];
    this.focusDistance = focusDistance!;
    this.focusRange = focusRange!;
    this.focusFalloff = focusFalloff!;
    this.maxBlur = maxBlur!;
    this.debug = debug!;
  }

  /**
   * Adds the blur for this slot in the chain: one pass at `'high'`, and at `'low'` a blur at half the screen's
   * resolution and a merge back to full size
   * @param graph - Render graph being built.
   * @param io - Input/output handles for this slot in the chain.
   * @example
   * ```ts
   * const focused = graph.createColor({ label: 'focused' });
   * depthOfField.build(graph, { ...io, output: focused });
   * ```
   * @advanced
   */
  public override build(graph: RenderGraph, io: EffectIO): void {
    if (this.quality === 'high') {
      super.build(graph, io);

      return;
    }

    const blurred = graph.createColor({ resolution: io.renderer.resolution / 2, label: 'depthOfFieldBlur' });

    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'depthOfField:blur',
        fragment: this.fragment,
        uniforms: this.uniforms,
        reads: { color: io.input, depth: graph.sceneDepth },
        writes: blurred,
      }),
    );
    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'depthOfField:merge',
        fragment: DOF_MERGE,
        uniforms: this.uniforms,
        reads: { color: blurred, color2: io.input, depth: graph.sceneDepth },
        writes: io.output,
      }),
    );
  }

  /**
   * Depth in front of the camera that is in focus, in world units
   * @example
   * ```ts
   * // Keep the orbit's target sharp while zooming.
   * orbit.on('change', () => (depthOfField.focusDistance = orbit.distance));
   * ```
   */
  public get focusDistance(): number {
    return this.uniforms.uniforms.uDof[0];
  }
  /**
   * Sets the depth in focus
   * @param value - Depth in front of the camera, in world units.
   */
  public set focusDistance(value: number) {
    this.writeLane(this.uniforms, 'uDof', 0, value);
  }

  /**
   * How far either side of the focus stays fully sharp, in world units
   * @example
   * ```ts
   * depthOfField.focusRange = 0.5;
   * ```
   */
  public get focusRange(): number {
    return this.uniforms.uniforms.uDof[1];
  }
  /**
   * Sets how far either side of the focus stays fully sharp
   * @param value - Distance from the focus, in world units.
   */
  public set focusRange(value: number) {
    this.writeLane(this.uniforms, 'uDof', 1, value);
  }

  /**
   * How far past {@link DepthOfFieldEffect#focusRange | focusRange} the blur takes to reach full strength, in world
   * units
   * @example
   * ```ts
   * depthOfField.focusFalloff = 5;
   * ```
   */
  public get focusFalloff(): number {
    return this.uniforms.uniforms.uDof[2];
  }
  /**
   * Sets how far past the sharp zone the blur takes to reach full strength
   * @param value - Distance past `focusRange`, in world units.
   */
  public set focusFalloff(value: number) {
    this.writeLane(this.uniforms, 'uDof', 2, value);
  }

  /**
   * Blur radius at full strength, in physical pixels on screen
   * @example
   * ```ts
   * depthOfField.maxBlur = 20 * app.renderer.resolution;
   * ```
   */
  public get maxBlur(): number {
    return this.uniforms.uniforms.uDof[3];
  }
  /**
   * Sets the blur radius at full strength
   * @param value - Radius in physical pixels on screen.
   */
  public set maxBlur(value: number) {
    this.writeLane(this.uniforms, 'uDof', 3, value);
  }

  /**
   * Whether to paint the focus zones instead of blurring, to place them by eye
   *
   * Over a dimmed grey copy of the frame, a white line marks the depth in focus and green the sharp zone. Blurred
   * areas shift toward orange in front of it and blue behind it, more so the stronger the blur.
   * @example
   * ```ts
   * depthOfField.debug = true;
   * ```
   */
  public get debug(): boolean {
    return this.uniforms.uniforms.uDofView[0] > 0.5;
  }
  /**
   * Sets whether to paint the focus zones
   * @param value - `true` to paint them instead of blurring.
   */
  public set debug(value: boolean) {
    this.writeLane(this.uniforms, 'uDofView', 0, value ? 1 : 0);
  }
}
