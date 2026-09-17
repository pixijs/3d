import type { UniformGroup } from 'pixi.js';

import type { RenderGraph } from '../../core/render-graph/RenderGraph';
import type { ColorHandle } from '../../core/render-graph/ResourceHandle';
import { Pass3D } from '../Pass3D';
import type { Pass3DOptions, PassContext } from '../Pass3D';
import { FullscreenPass } from './FullscreenPass';

/**
 * Backend shader bodies for an effect pass, written against the standard effect header
 *
 * Each body defines the entry function the fullscreen template calls per pixel:
 *
 *  - WGSL: `fn effect(uv: vec2<f32>) -> vec4<f32>`
 *  - GLSL: `vec4 effect(vec2 uv)`
 *
 * `uv` is content space: `[0,1]` across the view's viewport, orientation-correct for the
 * pass's target. The sample helpers take content-space UV and map it onto each pooled
 * texture's sub-rect themselves, so effect code never sees pooling.
 *
 * The header provides, according to the pass's `reads`:
 *
 *  - `sampleColor(uv)` and `sampleColorLod(uv, lod)`: the chain input; the LOD form addresses
 *    the mip chain when the input is mip-chained (see {@link PostEffect#inputMips}); and
 *    `inputTexel()`: one texel of that input as a UV step, for kernels sized to the input
 *  - `sampleColor2(uv)`: the second colour input of a combine pass
 *  - `sampleDepth(uv)`: raw non-linear scene depth, and `viewPos(uv)`: the view-space position
 *    reconstructed from it
 *  - `linearDepth(d)`: linear depth from a raw depth value, and `texel()`: one content-space
 *    texel as a UV step
 *
 * Declared uniforms bind as `fx.<name>` in WGSL and plain `<name>` in GLSL. The camera clip
 * terms are also reachable as `fxh.uFxClip` in WGSL and `uFxClip` in GLSL (near, far,
 * projection[0], projection[5]) for effects that project their own samples.
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
 * Per-slot facts handed to {@link PostEffect#build} — the shared {@link PassContext} plus the
 * chain's input and output for this position
 *
 * These are the only values the chain compiler decides per position; everything else (scene
 * depth, shared copies, new transients) comes off the graph itself. Handles are build-time
 * names; textures materialize per frame inside each pass's `render(session)`.
 * @category filters
 * @advanced
 */
export interface EffectIO extends PassContext {
  /** Chain image entering this effect */
  readonly input: ColorHandle;
  /**
   * Where this effect's result must land: an intermediate transient, or `null` when the
   * effect is elected presenter — pass it through as `writes` and the pass draws the View's
   * default target directly
   */
  readonly output: ColorHandle | null;
}

/**
 * Constructor options shared by every {@link PostEffect}
 * @category filters
 * @standard
 */
export type PostEffectOptions = Pass3DOptions;

/**
 * Base class for fullscreen post effects stacked on a view via {@link View3D#passes}
 *
 * A {@link Pass3D} at the `'post'` stage: after every scene draw, the chain compiler wires
 * post effects together in array order, ping-ponging the frame through them, and elects the
 * last one to present. Any enabled post effect makes the view render its scene into a
 * transient first.
 *
 * ## Authoring
 *
 * The single-shader case is declarative — provide `fragment`
 * (+ optional `uniforms`) and expose plain property
 * accessors that write into the group: a property write is a uniform update,
 * visible next frame, no version counters.
 *
 * Multi-pass effects override {@link PostEffect#build} and talk to the render
 * graph directly — the same `graph.addPass` / `graph.createColor` surface
 * every engine pass uses, no wrapper. The mental model is a pixi filter with
 * the render graph in hand:
 *
 * ```ts
 * public override build(graph: RenderGraph, io: EffectIO): void {
 *   const ao = graph.createColor({ resolution: 1, format: 'rgba8unorm' });
 *   graph.addPass(new FullscreenPass({
 *     renderer: io.renderer,
 *     reads: { depth: graph.sceneDepth },   // grab scene resources off the graph
 *     writes: ao,
 *     fragment: AO_FRAGMENT,
 *   }));
 *   graph.addPass(new FullscreenPass({
 *     renderer: io.renderer,
 *     reads: { color: io.input, color2: ao },
 *     writes: io.output,                    // the one contract: results land here
 *     fragment: MERGE_FRAGMENT,
 *   }));
 * }
 * ```
 *
 * Two contracts to honour: the effect's final image goes to `io.output`
 * (presenter election depends on the compiler owning that handle), and
 * handles resolve to textures only inside `render(session)` — never at build
 * time.
 *
 * ## Lifecycle
 *
 *  - `enabled` toggles rebuild the view's graph on the next render and re-key every mesh
 *    (pooled transients and cached shaders are reused). A settings toggle, not a per-frame
 *    lever: animate the effect's properties instead.
 *  - Reassigning `view.passes = [...]` is the structural lever: the
 *    array is a transaction — in-place mutation is not tracked.
 *  - Effects are never destroyed by reassignment; call
 *    {@link PostEffect#destroy} when an effect is retired for good.
 * @category filters
 * @standard
 */
export abstract class PostEffect extends Pass3D {
  /** Post effects always run in the post chain */
  public readonly stage = 'post';

  /**
   * Declare that `io.input` must carry a mip chain
   *
   * For blur/bokeh effects sampling coarse LODs via `sampleColorLod`. The chain compiler
   * allocates the input transient mip-chained and generates its levels after the producer —
   * the one input fact an effect cannot arrange from `build()`, since its input is allocated
   * before `build()` runs. Costs a mipmap generation and ~33% extra transient memory; leave `false`
   * unless the effect samples LODs.
   * @advanced
   */
  public readonly inputMips: boolean = false;

  /** Fragment for the declarative single-pass path — see {@link EffectFragment} */
  protected readonly fragment?: EffectFragment;

  /**
   * Uniforms consumed by {@link PostEffect#fragment}, or `null` for none
   *
   * Owned by the effect — passes reference it, rebuilds reuse it.
   */
  protected readonly uniforms: UniformGroup | null = null;

  constructor(options: PostEffectOptions = {}) {
    super(options);
  }

  /**
   * Write one lane of a vector uniform and mark its group dirty
   *
   * The building block of a live property: a setter writes its lane, the next frame reads it.
   * @param group - Uniform group the lane belongs to.
   * @param name - Uniform name inside the group.
   * @param lane - Component index within the uniform.
   * @param value - New value for that lane.
   */
  protected writeLane(group: UniformGroup, name: string, lane: number, value: number): void {
    (group.uniforms[name] as Float32Array)[lane] = value;
    group.update();
  }

  /**
   * Contribute this effect's passes at graph build time — see the class docs for the contract
   *
   * The default implementation compiles the declarative `fragment` into one
   * {@link FullscreenPass} reading the chain input and scene depth (both helpers always
   * available; unused ones cost nothing) and writing `io.output`.
   * @param graph - Render graph being built; add passes and transients to it.
   * @param io - Per-slot input/output handles for this position in the chain.
   * @advanced
   */
  public override build(graph: RenderGraph, io: EffectIO): void {
    const fragment = this.fragment;
    if (!fragment) {
      throw new Error(`${this.constructor.name}: provide a \`fragment\` or override \`build()\`.`);
    }

    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: this.constructor.name,
        fragment,
        uniforms: this.uniforms,
        reads: { color: io.input, depth: graph.sceneDepth },
        writes: io.output,
      }),
    );
  }
}
