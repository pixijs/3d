import type { VertexFormat } from 'pixi.js';

import type { CollectedBindings } from '../gpu/codegen/wgslBindingsPlugin';
import type { NormalizedShaderOverrideDef } from './collectOverrideDefs';
import type { InterStageType, ShaderBit, StructDefinition } from './ShaderBit';
import type { ShaderBitTemplate } from './ShaderBitTemplate';

/**
 * What the compiler plugins know about the shader between phases
 *
 * Plugins fill it in `collectData`, may change it in `preCompile`, and turn it into source in
 * `injectCode`.
 * @category rendering
 * @advanced
 */
export interface ShaderCompilerData {
  /** The bits' specialization constants, validated, keyed by name */
  overrides?: Record<string, NormalizedShaderOverrideDef>;
  /** The bits' bindings, merged per bind group */
  bindings?: CollectedBindings;
  /** Vertex attribute formats, keyed by attribute name */
  attributes?: Record<string, VertexFormat>;
  /** Varying types, keyed by varying name */
  interStage?: Record<string, InterStageType>;
  /** The bits' header code, in bit order */
  headers?: string[];
  /** Struct definitions, keyed by struct name */
  structs?: Record<string, StructDefinition>;
  /** Vertex code snippets, keyed by slot name */
  vertexSlots?: Record<string, string[]>;
  /** Fragment code snippets, keyed by slot name */
  fragmentSlots?: Record<string, string[]>;
  /**
   * Each binding's name, keyed by group index and then binding index
   *
   * WebGL shaders hand it to pixi, which otherwise builds it by reading a WebGPU program.
   */
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
   * The template source being compiled
   *
   * For WGSL this is `template.gpu`. GLSL compiles each stage on its own, so this is
   * `template.gl.vertex` on one run and `template.gl.fragment` on the next, over the same `data`.
   */
  templateString: string;

  /** What the plugins have collected so far */
  data: ShaderCompilerData;

  /** The GLSL stage being compiled; unset for WGSL, which compiles both at once */
  stage?: 'vertex' | 'fragment';

  /** Options for GLSL compilation only */
  glslOptions?: {
    /** The bind groups compiled as uniform blocks; any other group's uniforms become plain uniforms */
    uboGroups?: Set<string> | string[];
    /**
     * Whether to emit `layout(location = n)` qualifiers on attributes and varyings
     * @default true
     */
    useLocations?: boolean;
    /** The descriptor's override values, baked into the header as `#define`s */
    overrides?: Record<string, number>;
  };
}

/**
 * One step of shader compilation, run by {@link compileShader}
 *
 * Every plugin runs each phase before any plugin starts the next:
 *
 * 1. `collectData` reads the bits into `context.data`.
 * 2. `preCompile` may change `context.data` or `context.templateString`, such as repacking the
 *    `Material` struct.
 * 3. `injectCode` returns code for template slots, keyed by slot name.
 * @category rendering
 * @advanced
 */
export interface ShaderCompilerPlugin {
  /**
   * Reads the bits into `context.data`
   * @param {ShaderCompilerContext} context - The compilation context to fill
   */
  collectData?(context: ShaderCompilerContext): void;

  /**
   * Changes `context.data` or `context.templateString` once every plugin has collected
   * @param {ShaderCompilerContext} context - The compilation context to change
   */
  preCompile?(context: ShaderCompilerContext): void;

  /**
   * Returns code for template slots
   *
   * Code for one slot from several plugins is joined in plugin order. Blank code is skipped.
   * @param {ShaderCompilerContext} context - The compilation context to read
   * @returns Code keyed by slot name, such as `header` or `vertexBody`
   */
  injectCode?(context: ShaderCompilerContext): Record<string, string>;
}
