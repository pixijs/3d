import { assertBitIdentity } from './bitRegistry';
import { DEFAULT_OUTPUT_LOCATIONS } from './codegen/collectFragmentOutputs';
import type { ShaderBit } from './ShaderBit';
import type { ShaderBitTemplate } from './ShaderBitTemplate';

let nextTemplateUid = 0;

const outputKeys = new WeakMap<readonly string[], string>();

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
  /**
   * Custom shader template
   *
   * Left out, a material's `descriptor` uses the engine's material template. A pass's descriptor
   * has no default and must set one.
   */
  template?: ShaderBitTemplate;
  /**
   * Values for the bits' specialization constants ({@link ShaderOverrideDef}), such as
   * `{ OUTLINE_WIDTH: 0.1 }`
   *
   * Each distinct set of values compiles its own shader.
   */
  overrides?: Record<string, number>;
  /**
   * Which of the bits' {@link ShaderBit#outputs} each location writes, by name: entry `n` is
   * location `n`, the target's colour attachment `n`
   *
   * An output left out never reaches the GPU, and a name no bit declares leaves its attachment
   * alone. A material's `descriptor` ignores it, since the engine sets a material shader's
   * locations. Each distinct list compiles its own shader. A template without the output slots
   * ignores it.
   * @default ['color']
   */
  outputLocations?: readonly string[];
  /**
   * Whether the compiler adds the view-wide values, such as the lights and fog, in the `global` bind
   * group
   *
   * Set `false` for a template with no `global` group, or when the bits declare a `global` group of
   * their own. A material's `descriptor` ignores it and always has them.
   * @default true
   */
  includeGlobal?: boolean;
  /**
   * Whether the compiler adds the camera's position and matrices in the `camera` bind group
   *
   * Set it to match the template: `false` for one with no `camera` group. The compile throws when
   * they disagree. A material's `descriptor` ignores it and always has them.
   * @default true
   */
  includeCamera?: boolean;
}

/**
 * The {@link ShaderBit}s a shader is built from, per backend, with its template and overrides
 *
 * A material's `descriptor` option sets the bits of its main shader. Its `passes` option gives an
 * extra render pass, such as an outline, a descriptor of its own, keyed by pass name, as options
 * or as a built descriptor. The renderer adds the bits a mesh needs, such as skinning, so a
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
  /** Shader bits for the WebGPU (WGSL) backend */
  public bitsGpu: ShaderBit[];
  /** Shader bits for the WebGL (GLSL) backend */
  public bitsGl: ShaderBit[];
  /** Custom shader template; see {@link ShaderDescriptorOptions#template} */
  public template?: ShaderBitTemplate;
  /** Values for the bits' specialization constants; see {@link ShaderDescriptorOptions#overrides} */
  public overrides?: Record<string, number>;
  /** Which output each location writes, by name; see {@link ShaderDescriptorOptions#outputLocations} */
  public outputLocations: readonly string[];
  /** See {@link ShaderDescriptorOptions#includeGlobal} */
  public includeGlobal?: boolean;
  /** See {@link ShaderDescriptorOptions#includeCamera} */
  public includeCamera?: boolean;

  /** @internal */
  public keyGpu!: string;
  /** @internal */
  public keyGl!: string;

  constructor(options: ShaderDescriptorOptions) {
    this.bitsGpu = options.bitsGpu ?? [];
    this.bitsGl = options.bitsGl ?? [];
    this.template = options.template;
    this.overrides = options.overrides;
    this.outputLocations = options.outputLocations ?? DEFAULT_OUTPUT_LOCATIONS;
    this.includeGlobal = options.includeGlobal;
    this.includeCamera = options.includeCamera;
    this._updateKeys();
  }

  /**
   * Replaces every field from `options`, as the constructor would; a field left out goes back to
   * its default
   * @param options - The new descriptor contents
   * @returns This descriptor, for chaining
   */
  public update(options: ShaderDescriptorOptions): this {
    this.bitsGpu = options.bitsGpu ?? [];
    this.bitsGl = options.bitsGl ?? [];
    this.template = options.template;
    this.overrides = options.overrides;
    this.outputLocations = options.outputLocations ?? DEFAULT_OUTPUT_LOCATIONS;
    this.includeGlobal = options.includeGlobal;
    this.includeCamera = options.includeCamera;
    this._updateKeys();

    return this;
  }

  /** Checks each bit's claim to its name first, since the keys hold bit names in place of the bits */
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

    if (this.outputLocations !== DEFAULT_OUTPUT_LOCATIONS) {
      let outputKey = outputKeys.get(this.outputLocations);
      if (outputKey === undefined) {
        outputKey = `|out:${this.outputLocations.join(',')}`;
        outputKeys.set(this.outputLocations, outputKey);
      }
      keyGpu += outputKey;
      keyGl += outputKey;
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
