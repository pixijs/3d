/**
 * A shader template that defines the structure for compiled shaders
 *
 * Includes source templates, bind group order, and injection slots.
 *
 * ## Slot Naming
 *
 * - **GLSL**: Uses `{{slotName}}` directly (e.g., `{{header}}`, `{{body}}`)
 * - **WGSL**: Prefixes slots with stage name (e.g., `{{vertexBody}}`, `{{fragmentBody}}`)
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
  /** Bind group names in order (determines @group index) */
  readonly bindGroups: readonly string[];

  /** WebGPU/WGSL shader template (single source with both entry points) */
  readonly gpu?: string;

  /** WebGL/GLSL shader templates (separate vertex/fragment) */
  readonly gl?: {
    /** GLSL vertex shader template */
    readonly vertex: string;
    /** GLSL fragment shader template */
    readonly fragment: string;
  };

  /**
   * Lazy identity stamped on first use in a descriptor key — templates with the same bits must not collide in the shader cache
   * @internal
   */
  _uid?: number;
}
