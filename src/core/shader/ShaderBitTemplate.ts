/**
 * One bind group of a {@link ShaderBitTemplate}: its name, or its name with options
 *
 * A bare name is the same as `{ name }` with every option off.
 * @category rendering
 * @advanced
 */
export type TemplateBindGroup =
  | string
  | {
      /** The group's name, which bits use as the key of their `bindings` */
      readonly name: string;
      /**
       * Whether WebGL declares the group's uniform fields as one `std140` uniform block, named after
       * the group, rather than as plain uniforms
       *
       * A block doesn't count against the device's uniform vector limit. The `UniformGroup` bound to
       * the group must then be made with `ubo: true`. WebGPU ignores it.
       * @default false
       */
      readonly ubo?: boolean;
    };

/** @internal */
export interface ResolvedBindGroup {
  readonly name: string;
  readonly ubo: boolean;
}

/**
 * The source a shader compiles from: its entry points, with `{{slot}}` markers the bits fill
 *
 * `{{header}}` takes every bit's header code and the generated declarations for the attributes,
 * varyings and bindings. Every other marker takes the bits' code for that slot, in bit order, and a
 * marker no bit fills is removed.
 *
 * The WGSL template holds both entry points, so its slots carry the stage as a prefix: a bit's
 * `vertex.body` fills `{{vertexBody}}`. Each GLSL template holds one stage, so `vertex.body` fills
 * the vertex template's `{{body}}`. To write the bits' `outputs`, a template adds the slots
 * {@link ShaderBit#outputs} lists; any other template writes its fragment outputs itself.
 *
 * Shaders are cached by template identity, so build a template once and don't change it.
 * @example
 * ```ts
 * const pbrTemplate: ShaderBitTemplate = {
 *   bindGroups: [{ name: "global", ubo: true }, "camera", "batch"],
 *   gpu: `
 *     {{header}}
 *     @vertex fn mainVertex(input: VertexInput) -> VertexOutput {
 *       var output: VertexOutput;
 *       {{vertexBody}}
 *       return output;
 *     }
 *     @fragment fn mainFragment(input: FragmentInput) -> @location(0) vec4<f32> {
 *       {{fragmentBody}}
 *     }
 *   `,
 *   gl: {
 *     vertex: `#version 300 es
 *       {{header}}
 *       void main() {
 *         {{body}}
 *       }
 *     `,
 *     fragment: `#version 300 es
 *       {{header}}
 *       void main() {
 *         {{body}}
 *       }
 *     `,
 *   },
 * };
 * ```
 * @category rendering
 * @advanced
 */
export interface ShaderBitTemplate {
  /**
   * The bind groups the shader binds, in `@group` index order
   *
   * A template that draws meshes lists `global` then `camera`, since the engine binds those by
   * index, and a material's template adds `batch` after them for the material's data. List
   * `global` as `{ name: 'global', ubo: true }` wherever it appears, or the compile throws.
   */
  readonly bindGroups: readonly TemplateBindGroup[];

  /** The WGSL source for WebGPU, holding both entry points, named `mainVertex` and `mainFragment` */
  readonly gpu?: string;

  /** The GLSL sources for WebGL, one per stage, each with a `#version 300 es` line */
  readonly gl?: {
    /** GLSL vertex shader template */
    readonly vertex: string;
    /** GLSL fragment shader template */
    readonly fragment: string;
  };

  /** @internal */
  _uid?: number;
}

/** @internal */
export function resolveBindGroups(template: ShaderBitTemplate): readonly ResolvedBindGroup[] {
  return template.bindGroups.map((group) =>
    typeof group === 'string' ? { name: group, ubo: false } : { name: group.name, ubo: group.ubo ?? false },
  );
}
