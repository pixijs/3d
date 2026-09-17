import { BindGroup, State, Texture, TextureStyle, UniformGroup } from 'pixi.js';
import type { BLEND_MODES, Geometry, Shader, WebGLRenderer, WebGPURenderer } from 'pixi.js';

import { getCameraData } from '../../core/CameraData';
import type { PassBuilder } from '../../core/render-graph/PassBuilder';
import type { ColorHandle, DepthHandle } from '../../core/render-graph/ResourceHandle';
import { createOutputGeometry, createOutputState } from '../../core/render-passes/output/outputPassUtils';
import { RenderPass, RenderPassBit } from '../../core/render-passes/RenderPass';
import type { RenderSession } from '../../core/render-passes/RenderSession';
import type { BindingGroup, ShaderBit } from '../../core/shader/ShaderBit';
import { color2ReadBit, colorReadBit, depthReadBit, fullscreenEffectTemplate, fxhBit } from './fullscreenEffectShader';
import type { EffectFragment } from './PostEffect';

/**
 * Constructor options for {@link FullscreenPass}
 * @category rendering
 * @advanced
 */
export interface FullscreenPassOptions {
  /** Renderer the pass is built for */
  renderer: WebGLRenderer | WebGPURenderer;
  /** Debug label; fullscreen passes never take meshes, so names need not be unique and no pass bit is allocated */
  label?: string;
  /** Fragment body defining `effect(uv)` against the standard header */
  fragment: EffectFragment;
  /**
   * Uniforms the fragment declares — bound as the `fx` group's uniform block
   *
   * The schema must be constant per fragment; values are per-instance.
   */
  uniforms?: UniformGroup | null;
  /**
   * Named inputs — presence compiles the matching header helper
   *
   * `sampleColor`, `sampleColor2`, and `sampleDepth` + `viewPos` respectively.
   */
  reads?: {
    /** Chain colour bound to `sampleColor` */
    color?: ColorHandle;
    /** Second colour bound to `sampleColor2` */
    color2?: ColorHandle;
    /** Scene depth bound to `sampleDepth` / `viewPos` */
    depth?: DepthHandle;
  };
  /**
   * Target handle, or `null` to present
   *
   * Presenting writes the View's default target, blending premultiplied over the 2D beneath
   * it.
   */
  writes: ColorHandle | null;
  /**
   * Fixed-function blend onto the target, for in-place combine draws
   *
   * A pixi blend mode — `CombineOp`'s `'over'` maps to `'normal'` upstream. Ignored when
   * presenting.
   */
  blendMode?: Exclude<BLEND_MODES, 'inherit'>;
}

/** One wrapped bit per fragment object; fragments are module or class constants */
const fragmentBitCache = new WeakMap<EffectFragment, ShaderBit>();
let fragmentBitCount = 0;

/**
 * Wrap a fragment and its uniform schema into a shader bit, cached by fragment identity
 *
 * The cache survives graph rebuilds. The uniform schema must be constant per fragment:
 * instances vary only in uniform values, which bind as resources.
 * @param fragment - Fragment body; its identity is the cache key.
 * @param uniforms - Uniform schema the fragment declares, or `null` for none.
 */
function getFragmentBit(fragment: EffectFragment, uniforms: UniformGroup | null): ShaderBit {
  let bit = fragmentBitCache.get(fragment);
  if (bit) return bit;

  const fx: BindingGroup = Object.create(null);
  if (uniforms) {
    for (const name in uniforms.uniformStructures) {
      fx[name] = uniforms.uniformStructures[name].type as BindingGroup[string];
    }
  }

  bit = {
    name: `effectFragment:${fragmentBitCount++}`,
    bindings: { fx },
    gpu: { header: fragment.gpu },
    gl: { header: fragment.gl },
  };

  fragmentBitCache.set(fragment, bit);
  return bit;
}

/**
 * One fullscreen-triangle draw of an `effect(uv)` fragment
 *
 * The reusable primitive behind every effect pass, and equally usable from a custom graph.
 * It owns the triangle geometry, the bit-compiled shader (standard header: content-space UV,
 * orientation, the per-input clamp rects that map and guard the colour reads, `linearDepth` /
 * `viewPos`), per-frame transient rebinding, the WebGPU depth-aspect view, and the auto-fed `fxh`
 * uniforms (camera clip data + viewport texel).
 * @example
 * ```ts
 * graph.addPass(new FullscreenPass({ renderer, reads: { depth }, writes: ao, fragment: AO_FRAGMENT }));
 * ```
 * @category rendering
 * @advanced
 */
export class FullscreenPass extends RenderPass {
  private readonly _fragment: EffectFragment;
  private readonly _uniforms: UniformGroup | null;
  private readonly _reads: NonNullable<FullscreenPassOptions['reads']>;
  private readonly _writes: ColorHandle | null;
  private readonly _isWebGL: boolean;

  private readonly _geometry: Geometry;
  private readonly _state: State;
  private readonly _fxBindGroup: BindGroup;
  private readonly _fxhBindGroup: BindGroup;
  private readonly _fxhUniforms: UniformGroup;
  private readonly _colorSlot: number = -1;
  private readonly _color2Slot: number = -1;

  private _shader: Shader | null = null;
  private _destroyed = false;

  constructor(options: FullscreenPassOptions) {
    // NONE: fullscreen passes take no meshes — allocating registry bits per
    // label would exhaust the 24 custom slots.
    super({ renderer: options.renderer, name: options.label ?? 'fullscreen', bit: RenderPassBit.NONE });

    this._fragment = options.fragment;
    this._uniforms = options.uniforms ?? null;
    this._reads = options.reads ?? {};
    this._writes = options.writes;
    this._isWebGL = 'gl' in options.renderer;

    this._geometry = createOutputGeometry();

    if (this._writes === null) {
      // Presenter: premultiplied blend over the 2D content under the View.
      this._state = createOutputState();
    } else {
      const state = new State();
      state.depthTest = false;
      state.depthMask = false;
      state.culling = false;
      if (options.blendMode) {
        state.blend = true;
        state.blendMode = options.blendMode;
      } else {
        state.blend = false;
      }
      this._state = state;
    }

    // `fx` group layout mirrors the compiled binding map: uniform block first
    // (when the fragment declares uniforms), then each present read's
    // texture+sampler pair in [color, color2, depth] order — the same order
    // the header bits are composed in `_compile`.
    const entries: Record<number, unknown> = {};
    let slot = 0;
    const hasUniforms = this._uniforms !== null && Object.keys(this._uniforms.uniformStructures).length > 0;
    if (hasUniforms) entries[slot++] = this._uniforms;
    if (this._reads.color) {
      this._colorSlot = slot;
      entries[slot++] = Texture.WHITE.source;
      entries[slot++] = new TextureStyle({ scaleMode: 'linear', addressMode: 'clamp-to-edge' });
    }
    if (this._reads.color2) {
      this._color2Slot = slot;
      entries[slot++] = Texture.WHITE.source;
      entries[slot++] = new TextureStyle({ scaleMode: 'linear', addressMode: 'clamp-to-edge' });
    }
    // Depth is not in the fx group: it samples the GLOBAL group's opaque-depth
    // copy, auto-bound by the graph via the sample declaration in setup().
    this._fxBindGroup = new BindGroup(entries as ConstructorParameters<typeof BindGroup>[0]);

    this._fxhUniforms = new UniformGroup({
      uFxClip: { value: new Float32Array(4), type: 'vec4<f32>' },
      uFxTexel: { value: new Float32Array(4), type: 'vec4<f32>' },
      // One tap-bounds rect per colour input, filled per frame from that input's own texture.
      // The identity default covers the whole texture, for a pass with no colour read.
      uFxInputClamp: { value: new Float32Array([0, 0, 1, 1]), type: 'vec4<f32>' },
      uFxInput2Clamp: { value: new Float32Array([0, 0, 1, 1]), type: 'vec4<f32>' },
    });
    this._fxhBindGroup = new BindGroup({ 0: this._fxhUniforms });
  }

  /**
   * Declare this pass's reads and its colour write
   * @param b - Builder collecting the pass's resource dependencies.
   */
  public override setup(b: PassBuilder): void {
    if (this._reads.color) b.read(this._reads.color);
    if (this._reads.color2) b.read(this._reads.color2);
    // Depth rides the global group: the graph binds whichever depth handle
    // the compiler provisioned (scene-depth transient or the opaque copy)
    // into the opaque-depth slot each frame — depth-aspect views included.
    if (this._reads.depth) b.sample(this._reads.depth, this.pipe.globalSlots.opaqueDepth);

    if (this._writes) {
      b.writeColor(this._writes);
    } else {
      // Both declarations resolve the pass to the screen target so the
      // executor binds the View's on-canvas rect (see PassBuilder.writeColor).
      b.writeColor(b.defaultColor);
      b.writeDepth(b.defaultDepth);
    }
  }

  /**
   * Rebind per-frame transients, refresh the header uniforms, and draw the triangle
   * @param session - Per-frame render session supplying the resolved textures.
   */
  public override render(session: RenderSession): void {
    if (!this._shader) this._compile();

    // Auto-fed header data: camera clip terms + content-space texel. The flip
    // lane is 1 only when a WebGPU pass presents to the screen — transient
    // hops stay straight so chains never double-flip.
    const camera = session.view3d.camera;
    const proj = camera.projection.elements;
    const clip = this._fxhUniforms.uniforms.uFxClip as Float32Array;
    clip[0] = camera.near;
    clip[1] = camera.far;
    clip[2] = proj[0];
    clip[3] = proj[5];
    const texelLanes = this._fxhUniforms.uniforms.uFxTexel as Float32Array;
    texelLanes[0] = 1 / session.activeViewport.width;
    texelLanes[1] = 1 / session.activeViewport.height;
    // WebGPU flips every read (graph transients store flip-to-read, and a
    // straight NDC write re-inverts, so per-pass flips stay paired through a
    // chain — the invariant the old hand-rolled passes used); GL never flips.
    texelLanes[2] = this._isWebGL ? 0 : 1;

    // Each colour read carries its own tap bounds: a transient created at a `resolution` other
    // than the view's rounds into a different pool bucket, so the view's `uViewportUVScale`
    // would map it wrong. Depth is exempt — the opaque depth copy is always viewport-sized, so
    // the view's scale is its scale.
    const graph = session.view3d._graph;
    if (this._reads.color) {
      graph._inputClamp(this._reads.color, session, this._fxhUniforms.uniforms.uFxInputClamp as Float32Array);
    }
    if (this._reads.color2) {
      graph._inputClamp(this._reads.color2, session, this._fxhUniforms.uniforms.uFxInput2Clamp as Float32Array);
    }
    this._fxhUniforms.update();

    // Rebind read inputs every frame — pooled transients can change identity.
    if (this._reads.color) {
      this._fxBindGroup.setResource(graph._texture(this._reads.color, session).source, this._colorSlot);
    }
    if (this._reads.color2) {
      this._fxBindGroup.setResource(graph._texture(this._reads.color2, session).source, this._color2Slot);
    }

    // Bind groups: 0 = global, 1 = the view camera (the sample helpers map through its
    // `uViewportUVScale`), 2 = fx, 3 = fxh.
    this._shader!.groups[0] = session.globalBindGroup;
    this._shader!.groups[1] = getCameraData(camera).bindGroup;
    this._shader!.groups[2] = this._fxBindGroup;
    this._shader!.groups[3] = this._fxhBindGroup;

    this.pipe.renderGeometry(this._geometry, this._shader!, this._state);
  }

  private _compile(): void {
    // Bit order must match the fx bind-group slot layout in the constructor.
    const bits: ShaderBit[] = [fxhBit];
    if (this._reads.color) bits.push(colorReadBit);
    if (this._reads.color2) bits.push(color2ReadBit);
    if (this._reads.depth) bits.push(depthReadBit);
    bits.push(getFragmentBit(this._fragment, this._uniforms));

    this._shader = this.pipe.renderer.material3d.compilePassShader(bits, fullscreenEffectTemplate);
  }

  /** Release the pass-owned shader, geometry and bind groups; author uniforms are untouched */
  public override destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this._shader?.destroy();
    this._shader = null;
    this._geometry.destroy(true);
    // Detach bind-group slots; author uniforms are effect-owned and survive
    // graph rebuilds, pass-owned bits (fxh group, samplers) just drop.
    this._fxBindGroup.destroy();
    this._fxhBindGroup.destroy();
  }
}
