import { BindGroup, State, Texture, TextureStyle, UniformGroup } from 'pixi.js';
import type { BLEND_MODES, Shader, WebGLRenderer, WebGPURenderer } from 'pixi.js';

import { getCameraData } from '../../core/CameraData';
import { fullscreenTriangleGeometry } from '../../core/fullscreenTriangleGeometry';
import type { PassBuilder } from '../../core/render-graph/PassBuilder';
import type { ColorHandle, DepthHandle } from '../../core/render-graph/ResourceHandle';
import { createOutputState } from '../../core/render-passes/output/outputPassUtils';
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
  /** Renderer to build for; inside a `build`, the `renderer` on its context */
  renderer: WebGLRenderer | WebGPURenderer;
  /**
   * Debug name for the pass
   *
   * Unlike a {@link MeshPass} name it need not be unique: no material opts into a fullscreen pass.
   * @default 'fullscreen'
   */
  label?: string;
  /** Shader body defining `effect(uv)`; {@link EffectFragment} lists what it can call */
  fragment: EffectFragment;
  /**
   * Uniforms the fragment declares, reached as `fx.<name>` in WGSL and plain `<name>` in GLSL
   *
   * Passes that share one fragment object must declare the same uniform names and types: the
   * fragment is prepared for the shader once, from the first pass's uniforms. Their values are
   * free to differ.
   */
  uniforms?: UniformGroup | null;
  /**
   * Graph resources the fragment samples
   *
   * Each read given adds its helpers to the shader, so a fragment that calls a helper without
   * its read fails to compile.
   */
  reads?: {
    /** Colour input, read with `sampleColor`, `sampleColorLod` and `inputTexel` */
    color?: ColorHandle;
    /** Second colour input, read with `sampleColor2` */
    color2?: ColorHandle;
    /** Scene depth, read with `sampleDepth` and `viewPos` */
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
   * Blend mode for drawing onto a target that already holds an image, such as adding an
   * upsampled bloom level onto the level below it
   *
   * Left out, the pass overwrites the target. Ignored when presenting.
   */
  blendMode?: Exclude<BLEND_MODES, 'inherit'>;
}

/** One shader bit per fragment object, so a fragment shared by many passes is wrapped once */
const fragmentBitCache = new WeakMap<EffectFragment, ShaderBit>();
let fragmentBitCount = 0;

/**
 * Wrap a fragment and its uniform schema into a shader bit, cached by fragment identity
 *
 * The first caller's uniform schema is baked into the cached bit, which is why passes sharing a
 * fragment must share a schema. Uniform values are not part of the bit; they bind as resources.
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

/** What `createFxBindings` returns; a texture slot is `-1` when the pass has no such read */
interface FxBindings {
  group: BindGroup;
  colorSlot: number;
  color2Slot: number;
}

/**
 * Build the `fx` bind group for a pass's uniforms and colour reads
 *
 * Slot order has to match the binding map the shader compiles to: the uniform block first (when
 * the fragment declares uniforms), then a texture and sampler pair per colour read, in the order
 * `FullscreenPass._compile` lists the read bits. Change one order and the other must follow.
 *
 * Depth takes no slot: `depthReadBit` samples the global group instead.
 * @param uniforms - Uniforms the fragment declares, or `null` for none.
 * @param reads - The pass's named inputs.
 */
function createFxBindings(
  uniforms: UniformGroup | null,
  reads: NonNullable<FullscreenPassOptions['reads']>,
): FxBindings {
  const entries: Record<number, unknown> = {};
  let slot = 0;
  let colorSlot = -1;
  let color2Slot = -1;
  if (uniforms !== null && Object.keys(uniforms.uniformStructures).length > 0) entries[slot++] = uniforms;
  if (reads.color) {
    colorSlot = slot;
    entries[slot++] = Texture.WHITE.source;
    entries[slot++] = new TextureStyle({ scaleMode: 'linear', addressMode: 'clamp-to-edge' });
  }
  if (reads.color2) {
    color2Slot = slot;
    entries[slot++] = Texture.WHITE.source;
    entries[slot++] = new TextureStyle({ scaleMode: 'linear', addressMode: 'clamp-to-edge' });
  }

  return { group: new BindGroup(entries as ConstructorParameters<typeof BindGroup>[0]), colorSlot, color2Slot };
}

/** Clamp rect an input keeps when the pass has no colour read to fill it from */
const WHOLE_TEXTURE_CLAMP: readonly number[] = [0, 0, 1, 1];

/**
 * One fullscreen draw of an `effect(uv)` fragment, reading graph handles and writing one
 *
 * The building block of every post effect. A single-shader {@link PostEffect} adds one for you;
 * a multi-pass effect adds several from its `build`, and a custom graph can add them directly.
 * The pass binds its inputs each frame and supplies the helpers {@link EffectFragment} lists, so
 * the fragment only has to define `effect(uv)`.
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

  private readonly _state: State;
  private readonly _fxBindGroup: BindGroup;
  private readonly _fxhBindGroup: BindGroup;
  private readonly _fxhUniforms: UniformGroup;
  private readonly _colorSlot: number = -1;
  private readonly _color2Slot: number = -1;

  private _shader: Shader | null = null;
  private _destroyed = false;

  constructor(options: FullscreenPassOptions) {
    super({ renderer: options.renderer, name: options.label ?? 'fullscreen', bit: RenderPassBit.NONE });

    this._fragment = options.fragment;
    this._uniforms = options.uniforms ?? null;
    this._reads = options.reads ?? {};
    this._writes = options.writes;
    this._isWebGL = 'gl' in options.renderer;

    if (this._writes === null) {
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

    const fx = createFxBindings(this._uniforms, this._reads);
    this._fxBindGroup = fx.group;
    this._colorSlot = fx.colorSlot;
    this._color2Slot = fx.color2Slot;

    this._fxhUniforms = new UniformGroup({
      uFxClip: { value: new Float32Array(4), type: 'vec4<f32>' },
      uFxTexel: { value: new Float32Array(4), type: 'vec4<f32>' },
      uFxInputClamp: { value: new Float32Array(WHOLE_TEXTURE_CLAMP), type: 'vec4<f32>' },
      uFxInput2Clamp: { value: new Float32Array(WHOLE_TEXTURE_CLAMP), type: 'vec4<f32>' },
    });
    this._fxhBindGroup = new BindGroup({ 0: this._fxhUniforms });
  }

  /**
   * Declare this pass's reads and its colour write
   *
   * Depth is declared with `sample`, not `read`: the fragment reads it through the global group's
   * opaque-depth slot, and `sample` is what makes the graph bind it there.
   *
   * A presenting pass declares the default depth beside the default colour although it writes no
   * depth. The pair is what resolves it to the screen target (see `PassBuilder.writeColor`).
   * @param b - Builder collecting the pass's resource dependencies.
   */
  public override setup(b: PassBuilder): void {
    if (this._reads.color) b.read(this._reads.color);
    if (this._reads.color2) b.read(this._reads.color2);
    if (this._reads.depth) b.sample(this._reads.depth, this.pipe.globalSlots.opaqueDepth);

    if (this._writes) {
      b.writeColor(this._writes);
    } else {
      b.writeColor(b.defaultColor);
      b.writeDepth(b.defaultDepth);
    }
  }

  /**
   * Draw the effect for this frame
   *
   * Group indices follow `fullscreenEffectTemplate.bindGroups`. From the camera group the shader
   * takes `uViewportUVScale`, which the depth helpers map through.
   * @param session - Per-frame render session supplying the resolved textures.
   */
  public override render(session: RenderSession): void {
    if (!this._shader) this._compile();

    this._updateHeaderUniforms(session);
    this._bindReads(session);

    this._shader!.groups[0] = session.globalBindGroup;
    this._shader!.groups[1] = getCameraData(session.view3d.camera).bindGroup;
    this._shader!.groups[2] = this._fxBindGroup;
    this._shader!.groups[3] = this._fxhBindGroup;

    this.pipe.renderGeometry(fullscreenTriangleGeometry(), this._shader!, this._state);
  }

  /**
   * Fill the header uniforms `fxhBit` documents
   *
   * The flip lane is 1 on WebGPU, where a texture's V runs opposite to NDC Y, so a pass has to
   * flip its UV to read the rows the pass before it wrote. On WebGL the two agree.
   * @param session - Per-frame render session supplying the camera, viewport and graph.
   */
  private _updateHeaderUniforms(session: RenderSession): void {
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
    texelLanes[2] = this._isWebGL ? 0 : 1;

    const graph = session.view3d._graph;
    if (this._reads.color) {
      graph._inputClamp(this._reads.color, session, this._fxhUniforms.uniforms.uFxInputClamp as Float32Array);
    }
    if (this._reads.color2) {
      graph._inputClamp(this._reads.color2, session, this._fxhUniforms.uniforms.uFxInput2Clamp as Float32Array);
    }
    this._fxhUniforms.update();
  }

  /**
   * Point the `fx` group at this frame's colour read textures
   *
   * Runs every frame because pooled transients can change identity.
   * @param session - Per-frame render session supplying the resolved textures.
   */
  private _bindReads(session: RenderSession): void {
    const graph = session.view3d._graph;
    if (this._reads.color) {
      this._fxBindGroup.setResource(graph._texture(this._reads.color, session).source, this._colorSlot);
    }
    if (this._reads.color2) {
      this._fxBindGroup.setResource(graph._texture(this._reads.color2, session).source, this._color2Slot);
    }
  }

  /** Compile the shader from the header bits; the read bits keep the order `createFxBindings` gives their slots */
  private _compile(): void {
    const bits: ShaderBit[] = [fxhBit];
    if (this._reads.color) bits.push(colorReadBit);
    if (this._reads.color2) bits.push(color2ReadBit);
    if (this._reads.depth) bits.push(depthReadBit);
    bits.push(getFragmentBit(this._fragment, this._uniforms));

    this._shader = this.pipe.renderer.material3d.compilePassShader(bits, fullscreenEffectTemplate);
  }

  /**
   * Release the pass-owned shader and bind groups
   *
   * The `uniforms` it was given are left alone: the effect owns them and reuses them across
   * graph rebuilds.
   */
  public override destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this._shader?.destroy();
    this._shader = null;
    this._fxBindGroup.destroy();
    this._fxhBindGroup.destroy();
  }
}
