import { assertBitIdentity } from './bitRegistry';
import type { ShaderBit } from './ShaderBit';
import type { ShaderBitTemplate } from './ShaderBitTemplate';

/** The id the next template gets in shader cache keys */
let nextTemplateUid = 0;

/**
 * Options for a {@link ShaderDescriptor}: the {@link ShaderBit}s a shader is built from
 *
 * Each backend takes its own list, because a few bits exist for one backend only. Most lists name
 * the same bits.
 * @category rendering
 * @advanced
 */
export interface ShaderDescriptorOptions {
  /**
   * Shader bits for the WebGPU (WGSL) backend
   * @default []
   */
  bitsGpu?: ShaderBit[];
  /**
   * Shader bits for the WebGL (GLSL) backend
   * @default []
   */
  bitsGl?: ShaderBit[];
  /** Custom shader template; the render pass's default template when omitted */
  template?: ShaderBitTemplate;
  /**
   * Values for the bits' specialization constants, such as `{ OUTLINE_WIDTH: 0.1 }`
   *
   * WebGPU sets them on the pipeline and WebGL bakes them into the GLSL. Each distinct set of
   * values compiles its own shader.
   */
  overrides?: Record<string, number>;
  /**
   * Whether the compiler adds the backend's global bit: the lights, fog and other view-wide values
   * in the `global` bind group
   *
   * Set `false` when the bits declare a `global` group of their own, as the shadow pass does.
   * @default true
   */
  includeGlobal?: boolean;
  /**
   * Whether the compiler adds the camera bit: the camera's position and matrices in the `camera`
   * bind group
   *
   * Set `false` only for a template with no `camera` group. A template that lists one but gets no
   * bit for it fails to compile, with an error naming this flag.
   * @default true
   */
  includeCamera?: boolean;
}

/**
 * The {@link ShaderBit}s a shader is built from, per backend, with its template and overrides
 *
 * A material's `descriptor` option sets the bits of its main shader. Its `passes` option gives
 * each extra render pass, such as an outline, a descriptor of its own, keyed by pass name, as
 * options or as a built descriptor.
 *
 * The renderer adds the global and camera bits, and the bits a mesh needs, such as skinning, so a
 * material lists only its own.
 * @example
 * ```ts
 * new BaseMaterial3D({
 *   descriptor: { bitsGpu: [myBit], bitsGl: [myBit] },
 * });
 *
 * new BaseMaterial3D({
 *   descriptor: { bitsGpu: [myBit], bitsGl: [myBit] },
 *   passes: {
 *     outline: {
 *       shaderDescriptor: {
 *         bitsGpu: [outlineBit], bitsGl: [outlineBit],
 *         template: outlineTemplate,
 *       },
 *     },
 *   },
 * });
 * ```
 * @category rendering
 * @advanced
 */
export class ShaderDescriptor {
  /** Shader bits composed for the WebGPU (WGSL) backend */
  public bitsGpu: ShaderBit[];
  /** Shader bits composed for the WebGL (GLSL) backend */
  public bitsGl: ShaderBit[];
  /** Custom shader template; the render pass's default template when omitted */
  public template?: ShaderBitTemplate;
  /** Values for the bits' specialization constants; see {@link ShaderDescriptorOptions#overrides} */
  public overrides?: Record<string, number>;
  /** See {@link ShaderDescriptorOptions#includeGlobal} */
  public includeGlobal?: boolean;
  /** See {@link ShaderDescriptorOptions#includeCamera} */
  public includeCamera?: boolean;

  /**
   * This descriptor's part of the WebGPU shader cache key
   * @internal
   */
  public keyGpu!: string;
  /**
   * This descriptor's part of the WebGL shader cache key
   * @internal
   */
  public keyGl!: string;

  constructor(options: ShaderDescriptorOptions) {
    this.bitsGpu = options.bitsGpu ?? [];
    this.bitsGl = options.bitsGl ?? [];
    this.template = options.template;
    this.overrides = options.overrides;
    this.includeGlobal = options.includeGlobal;
    this.includeCamera = options.includeCamera;
    this._updateKeys();
  }

  /**
   * Replaces every field from `options`, as the constructor would, and recomputes the cache keys
   *
   * A field `options` leaves out goes back to its default.
   * @param options - The new descriptor contents
   * @returns This descriptor, for chaining
   */
  public update(options: ShaderDescriptorOptions): this {
    this.bitsGpu = options.bitsGpu ?? [];
    this.bitsGl = options.bitsGl ?? [];
    this.template = options.template;
    this.overrides = options.overrides;
    this.includeGlobal = options.includeGlobal;
    this.includeCamera = options.includeCamera;
    this._updateKeys();

    return this;
  }

  /**
   * Rebuilds both cache keys from the bit names, the override values and the template's id
   *
   * Bit names stand for the bits in the key, so each bit's claim to its name is checked first, and
   * a second bit with the same name throws here rather than get the first bit's shader. A template
   * stands in by identity, which holds because its fields are readonly.
   */
  private _updateKeys(): void {
    for (let i = 0; i < this.bitsGpu.length; i++) assertBitIdentity(this.bitsGpu[i]);
    for (let i = 0; i < this.bitsGl.length; i++) assertBitIdentity(this.bitsGl[i]);

    let keyGpu = this.bitsGpu.map((b) => b.name).join('|');
    let keyGl = this.bitsGl.map((b) => b.name).join('|');

    if (this.overrides) {
      const overrideKey = Object.entries(this.overrides)
        .map(([k, v]) => `${k}=${v}`)
        .join(',');
      keyGpu += `[${overrideKey}]`;
      keyGl += `[${overrideKey}]`;
    }

    if (this.template) {
      const uid = (this.template._uid ??= nextTemplateUid++);
      keyGpu += `|tpl:${uid}`;
      keyGl += `|tpl:${uid}`;
    }

    this.keyGpu = keyGpu;
    this.keyGl = keyGl;
  }
}
