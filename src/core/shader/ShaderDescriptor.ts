import { assertBitIdentity } from './bitRegistry';
import type { ShaderBit } from './ShaderBit';
import type { ShaderBitTemplate } from './ShaderBitTemplate';

/** Monotonic ids for custom templates — see `ShaderDescriptor._updateKeys` */
let nextTemplateUid = 0;

/**
 * Options for creating a {@link ShaderDescriptor}
 *
 * A descriptor tells the engine which {@link ShaderBit}s to compose into
 * a complete shader program. Think of bits as lego bricks and the
 * descriptor as the instruction sheet that says which bricks to use.
 *
 * Most materials use the same bits for both WebGPU and WebGL. When they
 * differ (e.g. backend-specific lighting or IBL bits), provide separate
 * `bitsGpu` and `bitsGl` arrays.
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
  /** WGSL specialization constant overrides (e.g. `{ OUTLINE_WIDTH: 0.1 }`) */
  overrides?: Record<string, number>;
  /**
   * Whether the backend's global bit (lights, fog and scene globals at bind group 0) is
   * auto-prepended at compile time
   *
   * Defaults to `true`, so custom passes only declare what's unique to them. Set `false` for
   * passes that supply their own global-level bindings — e.g. the shadow pass declares a lean
   * `global` group of its own and would crash if the full global bit were merged in.
   */
  includeGlobal?: boolean;
  /**
   * Whether the camera bit (the camera's position, matrices and viewport UV scale at bind
   * group 1) is auto-prepended at compile time
   *
   * Defaults to `true`; every mesh-drawing template binds the camera group. Set `false` only
   * for a template that declares no `camera` group at all — a template that declares one but
   * gets no bit for it fails at compile, naming this flag.
   */
  includeCamera?: boolean;
}

/**
 * Describes how a material's shader is assembled from composable {@link ShaderBit}s
 *
 * Each material has a primary descriptor (set via the `descriptor` constructor
 * option) that defines its main rendering shader. Materials can also provide
 * additional descriptors for custom render passes (shadow, outline, etc.)
 * via the `passes` option.
 * @example
 * ```ts
 * // Simple material — same bits for GPU and GL
 * new BaseMaterial3D({
 *   descriptor: { bitsGpu: [myBit], bitsGl: [myBit] },
 * });
 *
 * // Material with a custom outline pass — keyed by the pass's `name`.
 * // The `shaderDescriptor` field accepts a plain options object (auto-wrapped) or a
 * // pre-built {@link ShaderDescriptor}.
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
  /** WGSL specialization constant overrides */
  public overrides?: Record<string, number>;
  /** See {@link ShaderDescriptorOptions#includeGlobal} */
  public includeGlobal?: boolean;
  /** See {@link ShaderDescriptorOptions#includeCamera} */
  public includeCamera?: boolean;

  /**
   * Pre-computed cache key fragment for the GPU bits
   * @internal
   */
  public keyGpu!: string;
  /**
   * Pre-computed cache key fragment for the GL bits
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
   * Updates bits, template, and overrides in place and recomputes cache keys
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

  private _updateKeys(): void {
    // Bit names ARE the cache identity, so verify each one is globally
    // unique (a stamped-flag fast path after a bit's first check). A
    // genuine collision throws here — before the key can mis-serve a
    // cached shader.
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

    // A custom template changes the compiled output for the same bit list,
    // so it must participate in the key. Identity (lazy uid) is enough —
    // templates are module constants, not a user-extension surface.
    if (this.template) {
      const uid = (this.template._uid ??= nextTemplateUid++);
      keyGpu += `|tpl:${uid}`;
      keyGl += `|tpl:${uid}`;
    }

    this.keyGpu = keyGpu;
    this.keyGl = keyGl;
  }
}
