import { BindGroup, State, Texture, TextureStyle, UniformGroup } from 'pixi.js';
import type { BLEND_MODES, Shader, WebGLRenderer, WebGPURenderer } from 'pixi.js';

import { getCameraData } from '../../core/CameraData';
import { fullscreenTriangleGeometry } from '../../core/fullscreenTriangleGeometry';
import type { PassBuilder } from '../../core/render-graph/PassBuilder';
import type { ColorHandle, DepthHandle } from '../../core/render-graph/ResourceHandle';
import type { TextureBinding } from '../../core/render-graph/TextureBinding';
import { RenderPass, RenderPassBit } from '../../core/render-passes/RenderPass';
import type { RenderSession } from '../../core/render-passes/RenderSession';
import type { BindingGroup, ShaderBit } from '../../core/shader/ShaderBit';
import { DEPTH_VIEW_PLACEHOLDER } from '../../core/textures/DefaultTextures';
import {
  color2ReadBit,
  colorReadBit,
  depthReadBitGl,
  depthReadBitGpu,
  fullscreenEffectTemplate,
  fxhBit,
} from './fullscreenEffectShader';
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
   * Debug name for the pass; other fullscreen passes can share it
   * @default 'fullscreen'
   */
  label?: string;
  /**
   * Shader body defining `effect(uv)`; {@link EffectFragment} lists what it can call
   *
   * {@link passthroughFragment} copies the colour input unchanged.
   */
  fragment: EffectFragment;
  /**
   * Uniforms the fragment declares; {@link EffectFragment} gives their names in the shader
   *
   * Passes that share one fragment object must declare the same uniform names and types, though
   * their values can differ.
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
    /** Scene depth, read with `sampleDepth`, `viewPos` and `depthTexel` */
    depth?: DepthHandle;
  };
  /**
   * Where the pass draws: a graph handle, or `null` for the view's rect on screen, blended
   * premultiplied over the 2D content beneath
   *
   * A handle to an imported `RenderTexture` works too, and the image lands upright in it on both
   * backends.
   */
  writes: ColorHandle | null;
  /**
   * Blend mode for drawing over what the target already holds, such as adding a bloom level onto
   * the one below it
   *
   * Left out, the pass overwrites the target. Ignored when `writes` is `null`.
   */
  blendMode?: Exclude<BLEND_MODES, 'inherit'>;
  /**
   * Shader bits whose fragment `end` code runs after `effect(uv)`, in order
   *
   * They read the result as `fxColor` and change its RGB in `finalColor`; the pass keeps
   * `fxColor`'s alpha.
   */
  extraBits?: readonly ShaderBit[];
}

/**
 * A fragment that copies its colour input unchanged, for a {@link FullscreenPass} with a `reads.color`
 *
 * The input is stretched over the whole target, whatever their sizes.
 * @example
 * ```ts
 * graph.addPass(
 *   new FullscreenPass({ renderer, fragment: passthroughFragment, reads: { color: normals }, writes: copy }),
 * );
 * ```
 * @category rendering
 * @advanced
 */
export const passthroughFragment: EffectFragment = {
  gpu: 'fn effect(uv: vec2<f32>) -> vec4<f32> { return sampleColor(uv); }',
  gl: 'vec4 effect(vec2 uv) { return sampleColor(uv); }',
};

const fragmentBitCache = new WeakMap<EffectFragment, ShaderBit>();
let fragmentBitCount = 0;

/** Cached per fragment object with the first caller's uniform types, as `FullscreenPassOptions.uniforms` warns */
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

/** A binding is `null` when the pass has no such read */
interface FxBindings {
  group: BindGroup;
  color: TextureBinding | null;
  color2: TextureBinding | null;
  depth: TextureBinding | null;
}

/**
 * Names each resource as the read bits in `fullscreenEffectShader.ts` declare it; depth binds here, not in the
 * view's global group, which would keep it bound while the next frame's scene draws into it
 */
function createFxBindings(
  uniforms: UniformGroup | null,
  reads: NonNullable<FullscreenPassOptions['reads']>,
): FxBindings {
  const entries: NonNullable<ConstructorParameters<typeof BindGroup>[0]> = {};

  if (uniforms !== null && Object.keys(uniforms.uniformStructures).length > 0) entries.fx = uniforms;
  if (reads.color) {
    entries.uTexture = Texture.WHITE.source;
    entries.uTextureSampler = new TextureStyle({ scaleMode: 'linear', addressMode: 'clamp-to-edge' });
  }
  if (reads.color2) {
    entries.uTexture2 = Texture.WHITE.source;
    entries.uTexture2Sampler = new TextureStyle({ scaleMode: 'linear', addressMode: 'clamp-to-edge' });
  }
  if (reads.depth) entries.uFxDepthTexture = DEPTH_VIEW_PLACEHOLDER;

  const group = new BindGroup(entries);
  return {
    group,
    color: reads.color ? { group, slot: 'uTexture' } : null,
    color2: reads.color2 ? { group, slot: 'uTexture2' } : null,
    depth: reads.depth ? { group, slot: 'uFxDepthTexture' } : null,
  };
}

const WHOLE_TEXTURE_CLAMP: readonly number[] = [0, 0, 1, 1];

/**
 * One fullscreen draw of an `effect(uv)` fragment, reading graph handles and writing one
 *
 * The building block of every post effect. A single-shader {@link PostEffect} adds one for you;
 * a multi-pass effect adds several from its `build`, and a custom graph can add them directly.
 * The graph binds its inputs each frame and the pass supplies the helpers {@link EffectFragment}
 * lists, so the fragment only has to define `effect(uv)`.
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
  private readonly _extraBits: readonly ShaderBit[];
  private readonly _isWebGL: boolean;

  private readonly _state: State;
  private readonly _fxBindGroup: BindGroup;
  private readonly _fxhBindGroup: BindGroup;
  private readonly _fxhUniforms: UniformGroup;
  private readonly _colorBinding: TextureBinding | null;
  private readonly _color2Binding: TextureBinding | null;
  private readonly _depthBinding: TextureBinding | null;

  private _shader: Shader | null = null;
  private _destroyed = false;

  constructor(options: FullscreenPassOptions) {
    super({ renderer: options.renderer, name: options.label ?? 'fullscreen', bit: RenderPassBit.NONE });

    this._fragment = options.fragment;
    this._uniforms = options.uniforms ?? null;
    this._reads = options.reads ?? {};
    this._writes = options.writes;
    this._extraBits = options.extraBits ?? [];
    this._isWebGL = 'gl' in options.renderer;

    const state = new State();
    state.depthTest = false;
    state.depthMask = false;
    state.culling = false;
    state.blend = this._writes === null || options.blendMode !== undefined;
    if (this._writes !== null && options.blendMode) state.blendMode = options.blendMode;
    this._state = state;

    const fx = createFxBindings(this._uniforms, this._reads);
    this._fxBindGroup = fx.group;
    this._colorBinding = fx.color;
    this._color2Binding = fx.color2;
    this._depthBinding = fx.depth;

    this._fxhUniforms = new UniformGroup({
      uFxClip: { value: new Float32Array(4), type: 'vec4<f32>' },
      uFxTexel: { value: new Float32Array(4), type: 'vec4<f32>' },
      uFxInputClamp: { value: new Float32Array(WHOLE_TEXTURE_CLAMP), type: 'vec4<f32>' },
      uFxInput2Clamp: { value: new Float32Array(WHOLE_TEXTURE_CLAMP), type: 'vec4<f32>' },
    });
    this._fxhBindGroup = new BindGroup({ fxh: this._fxhUniforms });
  }

  /**
   * Declares the pass's reads and its write
   *
   * When it draws to the view's target, it declares that target's depth too, as
   * {@link PassBuilder#writeColor} requires.
   * @param b - Builder collecting the pass's resource dependencies.
   */
  public override setup(b: PassBuilder): void {
    if (this._reads.color) b.sample(this._reads.color, this._colorBinding!);
    if (this._reads.color2) b.sample(this._reads.color2, this._color2Binding!);
    if (this._reads.depth) b.sample(this._reads.depth, this._depthBinding!);

    if (this._writes) {
      b.writeColor(this._writes);
    } else {
      b.writeColor(b.defaultColor);
      b.writeDepth(b.defaultDepth);
    }
  }

  /**
   * Draws the effect for this frame, binding its groups in the order the effect template declares
   * @param session - Per-frame render session supplying the resolved textures.
   */
  public override render(session: RenderSession): void {
    if (!this._shader) this._compile();

    this._updateHeaderUniforms(session);

    this._shader!.groups[0] = session.globalBindGroup;
    this._shader!.groups[1] = getCameraData(session.view3d.camera).bindGroup;
    this._shader!.groups[2] = this._fxBindGroup;
    this._shader!.groups[3] = this._fxhBindGroup;

    this.pipe.renderGeometry(fullscreenTriangleGeometry(), this._shader!, this._state);
  }

  /**
   * V flips on WebGPU, and again when the bound target's front-face inversion differs from the default target's;
   * the Y scale comes from the camera's GPU projection, negated on WebGPU, so `viewPos` is Y up on both backends
   */
  private _updateHeaderUniforms(session: RenderSession): void {
    const camera = session.view3d.camera;
    const gpu = getCameraData(camera).projection.elements;
    const clip = this._fxhUniforms.uniforms.uFxClip as Float32Array;
    clip[0] = camera.near;
    clip[1] = camera.far;
    clip[2] = gpu[0];
    clip[3] = this._isWebGL ? gpu[5] : -gpu[5];
    const texelLanes = this._fxhUniforms.uniforms.uFxTexel as Float32Array;
    texelLanes[0] = 1 / session.activeViewport.width;
    texelLanes[1] = 1 / session.activeViewport.height;
    const frontFaceInverted = (session.renderer as WebGLRenderer | WebGPURenderer).renderTarget.isFrontFaceInverted();
    texelLanes[2] = (this._isWebGL ? 0 : 1) ^ (frontFaceInverted !== session.defaultFrontFaceInverted ? 1 : 0);
    texelLanes[3] = session.activeViewport.width / session.viewport.width;

    const graph = session.view3d._graph;
    if (this._reads.color) {
      graph._inputClamp(this._reads.color, session, this._fxhUniforms.uniforms.uFxInputClamp as Float32Array);
    }
    if (this._reads.color2) {
      graph._inputClamp(this._reads.color2, session, this._fxhUniforms.uniforms.uFxInput2Clamp as Float32Array);
    }
    this._fxhUniforms.update();
  }

  private _compile(): void {
    const bits: ShaderBit[] = [fxhBit];
    if (this._reads.color) bits.push(colorReadBit);
    if (this._reads.color2) bits.push(color2ReadBit);
    if (this._reads.depth) bits.push(this._isWebGL ? depthReadBitGl : depthReadBitGpu);
    bits.push(getFragmentBit(this._fragment, this._uniforms), ...this._extraBits);

    this._shader = this.pipe.renderer.material3d.compilePassShader(bits, fullscreenEffectTemplate);
  }

  /** Releases the pass's shader and bind groups, leaving the `uniforms` it was given to their owner */
  public override destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this._shader?.destroy();
    this._shader = null;
    this._fxBindGroup.destroy();
    this._fxhBindGroup.destroy();
  }
}
