import { definedProps, isMobile, UniformGroup } from 'pixi.js';

import { PostEffect } from '../../../post-processing/effects/PostEffect';
import type { EffectFragment, PostEffectOptions } from '../../../post-processing/effects/PostEffect';

/**
 * A tap behind this pixel takes this pixel's radius, or what is behind would smear over sharp edges. Colour and
 * alpha share every weight, or the output stops being premultiplied over a transparent background. Taps read colour
 * at a texel centre, since a filtered read would carry a sharp edge's colour into a blurred tap beside it.
 */
function dofFragment(taps: number): EffectFragment {
  return {
    gpu: /* wgsl */ `
const DOF_TAPS: i32 = ${taps};
const DOF_GOLDEN: vec2<f32> = vec2<f32>(-0.7373688, 0.6754903);

fn dofAmount(lz: f32) -> f32 {
  let range = fx.uDof.y;
  let t = clamp((abs(lz - fx.uDof.x) - range) / max(fx.uDof.z, 0.0001), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn dofDebug(uv: vec2<f32>) -> vec4<f32> {
  let lz = linearDepth(sampleDepth(uv));
  let s = lz - fx.uDof.x;
  let grey = dot(sampleColor(uv).rgb, vec3<f32>(0.299, 0.587, 0.114));
  let blurred = select(vec3<f32>(0.3, 0.55, 1.0), vec3<f32>(1.0, 0.45, 0.2), s < 0.0);
  let zone = mix(vec3<f32>(0.25, 1.0, 0.45), blurred, dofAmount(lz));
  let line = 1.0 - smoothstep(0.0, (fx.uDof.y + fx.uDof.z) * 0.02 + 0.02, abs(s));
  return vec4<f32>(mix(mix(vec3<f32>(grey * 0.4), zone, 0.55), vec3<f32>(1.0), line * 0.9), 1.0);
}

fn effect(uv: vec2<f32>) -> vec4<f32> {
  if (fx.uDofView.x > 0.5) { return dofDebug(uv); }
  let px = viewTexel();
  let reach = fx.uDof.w;
  let cz = linearDepth(sampleDepth(uv));
  let cr = dofAmount(cz) * reach;
  let cw = 1.0 / max(3.14159265 * cr * cr, 1.0);
  var sum = sampleColor(uv) * cw;
  var wsum = cw;
  let cell = uv / px;
  let turn = fract(52.9829189 * fract(dot(cell, vec2<f32>(0.06711056, 0.00583715)))) * 6.2831853;
  var dir = vec2<f32>(cos(turn), sin(turn));
  let snap = inputTexel();
  let area = 2.0 * reach / f32(DOF_TAPS);
  for (var i = 0; i < DOF_TAPS; i = i + 1) {
    let d = (f32(i) + 0.5) / f32(DOF_TAPS) * reach;
    let tuv = (floor((uv + dir * d * px) / snap) + 0.5) * snap;
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
    gl: /* glsl */ `
const int DOF_TAPS = ${taps};
const vec2 DOF_GOLDEN = vec2(-0.7373688, 0.6754903);

float dofAmount(float lz) {
  float range = uDof.y;
  float t = clamp((abs(lz - uDof.x) - range) / max(uDof.z, 0.0001), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

vec4 dofDebug(vec2 uv) {
  float lz = linearDepth(sampleDepth(uv));
  float s = lz - uDof.x;
  float grey = dot(sampleColor(uv).rgb, vec3(0.299, 0.587, 0.114));
  vec3 blurred = s < 0.0 ? vec3(1.0, 0.45, 0.2) : vec3(0.3, 0.55, 1.0);
  vec3 zone = mix(vec3(0.25, 1.0, 0.45), blurred, dofAmount(lz));
  float line = 1.0 - smoothstep(0.0, (uDof.y + uDof.z) * 0.02 + 0.02, abs(s));
  return vec4(mix(mix(vec3(grey * 0.4), zone, 0.55), vec3(1.0), line * 0.9), 1.0);
}

vec4 effect(vec2 uv) {
  if (uDofView.x > 0.5) { return dofDebug(uv); }
  vec2 px = viewTexel();
  float reach = uDof.w;
  float cz = linearDepth(sampleDepth(uv));
  float cr = dofAmount(cz) * reach;
  float cw = 1.0 / max(3.14159265 * cr * cr, 1.0);
  vec4 sum = sampleColor(uv) * cw;
  float wsum = cw;
  vec2 cell = uv / px;
  float turn = fract(52.9829189 * fract(dot(cell, vec2(0.06711056, 0.00583715)))) * 6.2831853;
  vec2 dir = vec2(cos(turn), sin(turn));
  vec2 snap = inputTexel();
  float area = 2.0 * reach / float(DOF_TAPS);
  for (int i = 0; i < DOF_TAPS; i++) {
    float d = (float(i) + 0.5) / float(DOF_TAPS) * reach;
    vec2 tuv = (floor((uv + dir * d * px) / snap) + 0.5) * snap;
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

const DOF_FRAGMENTS: Record<'high' | 'low', EffectFragment> = {
  high: dofFragment(48),
  low: dofFragment(16),
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
   * - `'high'`: 48 taps, smooth at any blur radius.
   * - `'low'`: 16 taps, under half the cost; large blurs look grainy.
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
 * One pass at the scene's resolution with no mipmaps. On a 2022 mid-range phone at 1920 × 1080 it took about 26 ms
 * a frame at `quality: 'high'` and 7.5 ms at `'low'`, which `'auto'` picks there. It needs a perspective camera. Every property but `quality` can change every frame, so a focus that
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
    this.fragment = DOF_FRAGMENTS[this.quality];
    this.focusDistance = focusDistance!;
    this.focusRange = focusRange!;
    this.focusFalloff = focusFalloff!;
    this.maxBlur = maxBlur!;
    this.debug = debug!;
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
