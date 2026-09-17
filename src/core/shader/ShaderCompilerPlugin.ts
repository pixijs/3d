import type { VertexFormat } from 'pixi.js';

import type { CollectedBindings } from '../gpu/codegen/wgslBindingsPlugin';
import type { NormalizedShaderOverrideDef } from './collectOverrideDefs';
import type { InterStageType, ShaderBit, StructDefinition } from './ShaderBit';
import type { ShaderBitTemplate } from './ShaderBitTemplate';

/**
 * Strongly-typed intermediate data shared across the shader compilation phases
 *
 * Built up during `collectData`, available for modification in `preCompile`,
 * and stringified in `injectCode`.
 * @category rendering
 * @advanced
 */
export interface ShaderCompilerData {
  /** Normalized specialization-constant override definitions, keyed by name */
  overrides?: Record<string, NormalizedShaderOverrideDef>;
  /** Bind-group resources collected from the bits */
  bindings?: CollectedBindings;
  /** Vertex attribute name → format */
  attributes?: Record<string, VertexFormat>;
  /** Inter-stage (varying) name → type */
  interStage?: Record<string, InterStageType>;
  /** Raw header code snippets, in bit order */
  headers?: string[];
  /** Struct definitions keyed by struct name */
  structs?: Record<string, StructDefinition>;
  /** Vertex-stage slot name → code snippets */
  vertexSlots?: Record<string, string[]>;
  /** Fragment-stage slot name → code snippets */
  fragmentSlots?: Record<string, string[]>;
  /** Bind group index → binding index → resource name */
  groupMap?: Record<number, Record<number, string>>;
}

/**
 * Context passed to every plugin during the compilation pipeline
 * @category rendering
 * @advanced
 */
export interface ShaderCompilerContext {
  /** The shader bits currently being compiled */
  bits: ShaderBit[];

  /** The template defining bind groups and stage configurations */
  template: ShaderBitTemplate;

  /**
   * The template string currently being processed
   *
   * For WGSL, this is `template.gpu`. For GLSL, the core compiler runs twice:
   * once with `template.gl.vertex` and once with `template.gl.fragment`.
   */
  templateString: string;

  /**
   * Shared structured data populated during collectData, modified during preCompile,
   * and read during injectCode to produce the final source strings
   */
  data: ShaderCompilerData;

  /** Which stage is currently compiling (useful for GLSL plugins that behave differently per-stage) */
  stage?: 'vertex' | 'fragment';

  /** Configuration options specific to the GLSL compilation pipeline */
  glslOptions?: {
    /** Bind-group names compiled as WebGL2 UBOs; groups not listed become flat uniforms */
    uboGroups?: Set<string> | string[];
    /** Whether to emit explicit `layout(location)` qualifiers (WebGL2 style); defaults to true */
    useLocations?: boolean;
    /**
     * Runtime override values. Read by `glslOverridesPlugin` to bake
     * `#define KEY VALUE` directives into the GLSL header — the GL analogue
     * of WebGPU pipeline specialization constants.
     */
    overrides?: Record<string, number>;
  };
}

/**
 * A plugin that participates in the three-phase shader compilation pipeline
 *
 * 1. `collectData` — build structured data on `context.data`
 * 2. `preCompile`  — modify `context.data` (e.g. padding, field reordering)
 * 3. `injectCode`  — read from `context.data`, return slot code strings
 * @category rendering
 * @advanced
 */
export interface ShaderCompilerPlugin {
  /**
   * Phase 1: Populate `context.data` with structured objects
   * @param {ShaderCompilerContext} context - The compilation context to populate
   */
  collectData?(context: ShaderCompilerContext): void;

  /**
   * Phase 2: Modify `context.data` before source generation
   * @param {ShaderCompilerContext} context - The compilation context to modify
   */
  preCompile?(context: ShaderCompilerContext): void;

  /**
   * Phase 3: Read from `context.data` and return slot code strings
   * for template substitution (e.g., 'header', 'vertexBody')
   * @param {ShaderCompilerContext} context - The compilation context to read from
   * @returns Slot name → code string to substitute into the template
   */
  injectCode?(context: ShaderCompilerContext): Record<string, string>;
}
