import type { UniformGroup } from 'pixi.js';

import type { RenderGraph } from '../../core/render-graph/RenderGraph';
import type { ColorHandle } from '../../core/render-graph/ResourceHandle';
import { Pass3D } from '../Pass3D';
import type { EffectStage, Pass3DOptions, PassContext } from '../Pass3D';
import { FullscreenPass } from './FullscreenPass';

/** Must name each helper `depthReadBitGpu` in `fullscreenEffectShader.ts` defines, except `fxDepthContent` */
const DEPTH_HELPER_CALL = /\b(?:sampleDepth|viewPos|depthTexel)\s*\(/;

/**
 * Shader bodies for a post effect, one per backend, each defining the function run for every pixel
 *
 *  - WGSL: `fn effect(uv: vec2<f32>) -> vec4<f32>`
 *  - GLSL: `vec4 effect(vec2 uv)`
 *
 * `uv` runs from 0 to 1 across the view's viewport, the right way up for the pass's target. The
 * fragment can call these helpers, the first three only when the pass has the matching read
 * ({@link FullscreenPassOptions#reads}):
 *
 *  - `sampleColor(uv)` and `sampleColorLod(uv, lod)`: the colour input, the LOD form reading mips
 *    when the input has them ({@link PostEffect#inputMips}); `inputTexel()`: one texel of that
 *    input as a UV step
 *  - `sampleColor2(uv)`: the second colour input, such as a scene output
 *  - `sampleDepth(uv)`: raw scene depth; `viewPos(uv)`: the view-space position there;
 *    `depthTexel()`: one depth texel as a UV step, coarser than `texel()` when the effect runs at a
 *    finer resolution than the scene
 *  - `linearDepth(d)`: linear depth from a raw depth value. It and `viewPos` assume a perspective
 *    camera, and give wrong values under an orthographic one.
 *  - `texel()`: one pixel of the pass's target as a UV step
 *  - `viewTexel()`: one physical pixel of the view on screen as a UV step, for a size that has to
 *    look the same at any `View3D.resolution` and in any pass of the effect
 *
 * Declared uniforms are `fx.<name>` in WGSL and plain `<name>` in GLSL. To project samples of your
 * own, `fxh.uFxClip` in WGSL and `uFxClip` in GLSL hold (near, far, projection[0], projection[5]),
 * set so that `viewPos` and points projected with them are in view space, Y up, on both backends.
 * @category filters
 * @advanced
 */
export interface EffectFragment {
  /** WGSL body compiled for the WebGPU backend */
  gpu: string;
  /** GLSL body compiled for the WebGL backend */
  gl: string;
}

/**
 * What {@link PostEffect#build} receives: the {@link PassContext} plus this effect's input and output
 *
 * Anything else, such as the scene depth, comes from the graph.
 * @category filters
 * @advanced
 */
export interface EffectIO extends PassContext {
  /** The image this effect reads: the scene, or the result of the step before it */
  readonly input: ColorHandle;
  /**
   * Where this effect's final image must go; pass it as a {@link FullscreenPass}'s `writes`
   *
   * `null` when the effect is the last step and draws straight to the view's target.
   */
  readonly output: ColorHandle | null;
}

/**
 * Constructor options shared by every {@link PostEffect}
 * @example
 * ```ts
 * interface MyVignetteEffectOptions extends PostEffectOptions {
 *   strength?: number;
 * }
 * ```
 * @category filters
 * @standard
 */
export interface PostEffectOptions extends Pass3DOptions {
  /**
   * Whether the effect reads the scene as light, before the tone curve, or the picture as it will
   * show, after it
   *
   * Each effect class picks the right one by default, so set it only to move one instance, such as
   * a tint meant for the light rather than the picture. See {@link PostEffect#stage}.
   * @default 'beforeToneMapping', unless the effect's class says otherwise
   * @example
   * ```ts
   * new TintEffect({ tint: 0xffaa66, stage: 'beforeToneMapping' });
   * ```
   */
  stage?: EffectStage;
}

/**
 * Base class for fullscreen post effects, added to a view through {@link View3D#passes}
 *
 * After the scene draws, the view runs its `'beforeToneMapping'` effects in array order, then the
 * tone curve, then its `'afterToneMapping'` effects, each reading the image the step before drew.
 * Any enabled post effect makes the view draw its scene into a texture first, and a
 * `'beforeToneMapping'` one also makes that texture float, holding linear light; see
 * {@link View3D#toneMapping}.
 *
 * ## Authoring
 *
 * A single-shader effect sets `fragment`, and `uniforms` if it has any, and exposes properties that
 * write into those uniforms. A property write shows on the next frame.
 *
 * An effect runs at `'beforeToneMapping'` unless it passes another stage to `super`. There it
 * reads linear light, brightness above 1 included, which suits blur, glow, depth of field and
 * occlusion. Pass `'afterToneMapping'` for an effect that judges the picture as it shows, such as
 * edge detection or a final colour grade, or one that shows data rather than light, such as depth
 * or normals, so the tone curve leaves its colours alone. Spread the caller's options after the
 * stage, so one instance can still pick its own:
 *
 * ```ts
 * class MyOutlineEffect extends PostEffect {
 *   constructor(options: PostEffectOptions = {}) {
 *     super({ stage: 'afterToneMapping', ...options });
 *   }
 * }
 * ```
 *
 * A multi-pass effect overrides {@link PostEffect#build} and adds its own passes to the render
 * graph. Its final image must go to `io.output`:
 *
 * ```ts
 * public override build(graph: RenderGraph, io: EffectIO): void {
 *   const ao = graph.createColor({ resolution: 1, format: 'rgba8unorm' });
 *   graph.addPass(new FullscreenPass({
 *     renderer: io.renderer,
 *     reads: { depth: graph.sceneDepth },
 *     writes: ao,
 *     fragment: AO_FRAGMENT,
 *   }));
 *   graph.addPass(new FullscreenPass({
 *     renderer: io.renderer,
 *     reads: { color: io.input, color2: ao },
 *     writes: io.output,
 *     fragment: MERGE_FRAGMENT,
 *   }));
 * }
 * ```
 *
 * Toggling, reordering and retiring an effect work as for any pass; {@link View3D#passes} has
 * the rules.
 * @example
 * ```ts
 * class MyGreyscaleEffect extends PostEffect {
 *   protected readonly fragment: EffectFragment = {
 *     gpu: `
 * fn effect(uv: vec2<f32>) -> vec4<f32> {
 *   let color = sampleColor(uv);
 *   let luma = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
 *   return vec4<f32>(vec3<f32>(luma), color.a);
 * }
 * `,
 *     gl: `
 * vec4 effect(vec2 uv) {
 *   vec4 color = sampleColor(uv);
 *   float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
 *   return vec4(vec3(luma), color.a);
 * }
 * `,
 *   };
 * }
 *
 * view.passes = [new MyGreyscaleEffect()];
 * ```
 * @category filters
 * @standard
 */
export abstract class PostEffect extends Pass3D {
  /**
   * The stage the effect runs at, set by the {@link PostEffectOptions.stage | stage} option
   * @advanced
   */
  public readonly stage: EffectStage;

  /**
   * Whether the effect's input has mips, for an effect that reads coarse levels with
   * `sampleColorLod`, such as a blur
   *
   * Costs a mip generation every frame and about a third more memory for the input, so leave it
   * `false` unless the effect samples levels above 0.
   * @advanced
   */
  public readonly inputMips: boolean = false;

  /** The shader the default {@link PostEffect#build} draws; see {@link EffectFragment} */
  protected readonly fragment?: EffectFragment;

  /**
   * Uniforms the {@link PostEffect#fragment} declares, or `null` for none
   *
   * They outlive graph rebuilds, so values set on them stay.
   */
  protected readonly uniforms: UniformGroup | null = null;

  constructor(options: PostEffectOptions = {}) {
    super(options);
    this.stage = options.stage ?? 'beforeToneMapping';
  }

  /**
   * Writes one component of a vector uniform from a property setter, and marks the group changed
   * so the GPU copy updates
   * @param group - Uniform group the lane belongs to.
   * @param name - Uniform name inside the group; its value must be a `Float32Array`.
   * @param lane - Component index within the uniform.
   * @param value - New value for that lane.
   */
  protected writeLane(group: UniformGroup, name: string, lane: number, value: number): void {
    (group.uniforms[name] as Float32Array)[lane] = value;
    group.update();
  }

  /**
   * Adds this effect's passes to the graph
   *
   * The default adds one {@link FullscreenPass} that draws `fragment`, binding the
   * scene depth only when the fragment calls `sampleDepth`, `viewPos` or `depthTexel` by name. On an
   * antialiased canvas, reading the depth costs a copy of it each frame, shared by every effect that
   * reads it. Override it for a multi-pass effect, as the class docs show; {@link Pass3D#build} says
   * when handles become textures.
   * @param graph - Render graph being built; add passes and transients to it.
   * @param io - This effect's input and output, plus the renderer and opaque copies
   * @advanced
   */
  public override build(graph: RenderGraph, io: EffectIO): void {
    const fragment = this.fragment;
    if (!fragment) {
      throw new Error(`${this.constructor.name}: provide a \`fragment\` or override \`build()\`.`);
    }

    const readsDepth = DEPTH_HELPER_CALL.test(fragment.gpu) || DEPTH_HELPER_CALL.test(fragment.gl);
    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: this.constructor.name,
        fragment,
        uniforms: this.uniforms,
        reads: { color: io.input, depth: readsDepth ? graph.sceneDepth : undefined },
        writes: io.output,
      }),
    );
  }
}
