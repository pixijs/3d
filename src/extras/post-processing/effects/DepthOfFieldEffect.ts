import { definedProps, UniformGroup } from 'pixi.js';

import { PostEffect } from '../../../post-processing/effects/PostEffect';
import type { EffectFragment, PostEffectOptions } from '../../../post-processing/effects/PostEffect';

/**
 * A tap behind this pixel takes this pixel's radius, or what is behind would smear over sharp edges. Colour and
 * alpha share every weight, or the output stops being premultiplied over a transparent background. Taps read colour
 * at a texel centre, since a filtered read would carry a sharp edge's colour into a blurred tap beside it.
 */
const DOF_FRAGMENT: EffectFragment = {
  gpu: /* wgsl */ `
const DOF_TAPS: i32 = 48;
const DOF_GOLDEN: vec2<f32> = vec2<f32>(-0.7373688, 0.6754903);

fn dofRadius(lz: f32) -> f32 {
  let range = fx.uDof.y;
  let t = clamp((abs(lz - fx.uDof.x) - range) / max(range, 0.0001), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t) * fx.uDof.z;
}

fn effect(uv: vec2<f32>) -> vec4<f32> {
  let px = viewTexel();
  let reach = fx.uDof.z;
  let cz = linearDepth(sampleDepth(uv));
  let cr = dofRadius(cz);
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
    let tr = select(dofRadius(tz), cr, tz > cz);
    let w = clamp(tr - d + 0.5, 0.0, 1.0) * area * d / max(3.14159265 * tr * tr, 1.0);
    sum = sum + sampleColor(tuv) * w;
    wsum = wsum + w;
    dir = vec2<f32>(dir.x * DOF_GOLDEN.x - dir.y * DOF_GOLDEN.y, dir.x * DOF_GOLDEN.y + dir.y * DOF_GOLDEN.x);
  }
  return sum / wsum;
}
`,
  gl: /* glsl */ `
const int DOF_TAPS = 48;
const vec2 DOF_GOLDEN = vec2(-0.7373688, 0.6754903);

float dofRadius(float lz) {
  float range = uDof.y;
  float t = clamp((abs(lz - uDof.x) - range) / max(range, 0.0001), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t) * uDof.z;
}

vec4 effect(vec2 uv) {
  vec2 px = viewTexel();
  float reach = uDof.z;
  float cz = linearDepth(sampleDepth(uv));
  float cr = dofRadius(cz);
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
    float tr = tz > cz ? cr : dofRadius(tz);
    float w = clamp(tr - d + 0.5, 0.0, 1.0) * area * d / max(3.14159265 * tr * tr, 1.0);
    sum += sampleColor(tuv) * w;
    wsum += w;
    dir = vec2(dir.x * DOF_GOLDEN.x - dir.y * DOF_GOLDEN.y, dir.x * DOF_GOLDEN.y + dir.y * DOF_GOLDEN.x);
  }
  return sum / wsum;
}
`,
};

/**
 * Constructor options for {@link DepthOfFieldEffect}
 * @example
 * ```ts
 * const options: DepthOfFieldEffectOptions = { focusDistance: 8, focusRange: 1, maxBlur: 16 };
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
   * Past it the blur grows, reaching {@link DepthOfFieldEffectOptions#maxBlur | maxBlur} at twice this distance.
   * @default 1
   * @example
   * ```ts
   * new DepthOfFieldEffect({ focusRange: 0.5 });
   * ```
   */
  focusRange?: number;
  /**
   * Blur radius at full strength, in physical pixels on screen
   *
   * Multiply by `renderer.resolution` for the same look on a 2× screen. The shader always takes the same number of
   * taps, so a larger radius looks grainier rather than taking more taps.
   * @default 12
   * @example
   * ```ts
   * new DepthOfFieldEffect({ maxBlur: 20 });
   * ```
   */
  maxBlur?: number;
}

/**
 * Depth of field: the scene is sharp at one depth and blurs in front of it and behind it, as through a camera lens
 *
 * Sharp edges stay sharp against a blurred background, and a blurred foreground spreads over what is behind it.
 * Over a view with no background, blurred edges fade to transparent, so the effect composites over the page.
 *
 * One pass at the scene's resolution, 48 taps per pixel, with no mipmaps; a slight grain at large blur radii is
 * the price. It needs a perspective camera. Every property can change every frame, so a focus that follows a
 * target costs a uniform write.
 *
 * {@link TiltShiftEffect} also blurs by depth, but blurs its input's mipmaps instead, which is cheaper but leaves a
 * soft halo round sharp edges. Use it for the miniature look and this effect for a lens.
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
    maxBlur: 12,
  };

  protected override readonly uniforms = new UniformGroup({
    uDof: { value: new Float32Array(4), type: 'vec4<f32>' },
  });

  protected override readonly fragment = DOF_FRAGMENT;

  constructor(options: DepthOfFieldEffectOptions = {}) {
    const { focusDistance, focusRange, maxBlur, ...rest } = {
      ...DepthOfFieldEffect.defaultOptions,
      ...definedProps(options),
    };

    super(rest);

    this.focusDistance = focusDistance!;
    this.focusRange = focusRange!;
    this.maxBlur = maxBlur!;
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
   * How far either side of the focus stays fully sharp, in world units; the blur is full at twice it
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
   * Blur radius at full strength, in physical pixels on screen
   * @example
   * ```ts
   * depthOfField.maxBlur = 20 * app.renderer.resolution;
   * ```
   */
  public get maxBlur(): number {
    return this.uniforms.uniforms.uDof[2];
  }
  /**
   * Sets the blur radius at full strength
   * @param value - Radius in physical pixels on screen.
   */
  public set maxBlur(value: number) {
    this.writeLane(this.uniforms, 'uDof', 2, value);
  }
}
