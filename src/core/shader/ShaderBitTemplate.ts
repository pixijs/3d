/**
 * The source a shader compiles from: its entry points, with `{{slot}}` markers the bits fill
 *
 * `{{header}}` takes every bit's header code and the declarations the compiler generates for the
 * attributes, varyings and bindings. Every other marker takes the code the bits give for that slot,
 * joined in bit order, and a marker no bit fills is removed.
 *
 * The WGSL template is one source that holds both entry points, so its stage slots carry the stage
 * as a prefix: a bit's `vertex.body` fills `{{vertexBody}}`. Each GLSL template holds one stage, so
 * its slots don't: `vertex.body` fills the vertex template's `{{body}}`.
 *
 * Compiled shaders are cached by template identity, so build a template once and don't change it.
 * @example
 * ```ts
 * const pbrTemplate: ShaderBitTemplate = {
 *   bindGroups: ["global", "camera", "batch"],
 *   gpu: `
 *     {{header}}
 *     @vertex fn vertexMain(input: VertexInput) -> VertexOutput {
 *       var output: VertexOutput;
 *       {{vertexBody}}
 *       return output;
 *     }
 *     @fragment fn fragmentMain(input: FragmentInput) -> @location(0) vec4<f32> {
 *       {{fragmentBody}}
 *     }
 *   `,
 *   gl: {
 *     vertex: `
 *       {{header}}
 *       void main() {
 *         {{body}}
 *       }
 *     `,
 *     fragment: `
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
  /** The bind groups the shader binds, in `@group` index order */
  readonly bindGroups: readonly string[];

  /** The WGSL source for WebGPU, holding both entry points */
  readonly gpu?: string;

  /** The GLSL sources for WebGL, one per stage */
  readonly gl?: {
    /** GLSL vertex shader template */
    readonly vertex: string;
    /** GLSL fragment shader template */
    readonly fragment: string;
  };

  /**
   * This template's id in shader cache keys, stamped the first time a descriptor uses it
   * @internal
   */
  _uid?: number;
}
