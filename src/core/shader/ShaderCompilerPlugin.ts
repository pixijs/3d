import type { VertexFormat } from 'pixi.js';

import type { InstanceDataLayout } from '../batcher/instanceDataLayout';
import type { CollectedBindingsGlsl } from '../gl/codegen/glslBindingsPlugin';
import type { CollectedBindings } from '../gpu/codegen/wgslBindingsPlugin';
import type { NormalizedShaderOverrideDef } from './collectOverrideDefs';
import type { FragmentOutputType, InterStageType, ShaderBit, StructDefinition } from './ShaderBit';
import type { ShaderBitTemplate } from './ShaderBitTemplate';

/** @internal */
export interface ShaderCompilerData {
  overrides?: Record<string, NormalizedShaderOverrideDef>;
  bindings?: CollectedBindings;
  attributes?: Record<string, VertexFormat>;
  interStage?: Record<string, InterStageType>;
  /** In the order the bits first declare them; unset for a template without the output slots */
  outputs?: Record<string, FragmentOutputType>;
  /** In bit order */
  headers?: string[];
  structs?: Record<string, StructDefinition>;
  vertexSlots?: Record<string, string[]>;
  fragmentSlots?: Record<string, string[]>;
  /** Each binding's name, keyed by group index and then binding index */
  groupMap?: Record<number, Record<number, string>>;
  /** Built on the vertex run and reused on the fragment run */
  glsl?: {
    attributes?: string;
    interStage?: {
      vertex: string;
      fragment: string;
    };
    bindingGroups?: CollectedBindingsGlsl;
    bindings?: string;
  };
}

/** @internal */
export interface ShaderCompilerContext {
  bits: ShaderBit[];
  template: ShaderBitTemplate;
  /** `template.gpu` for WGSL; GLSL runs once per stage over the same `data`, `template.gl.vertex` first */
  templateString: string;
  data: ShaderCompilerData;
  /** The output each location writes, indexed by location */
  outputLocations: readonly string[];
  /** Unset for WGSL, which compiles both stages at once */
  stage?: 'vertex' | 'fragment';
  glslOptions?: {
    /** Unset means `true` */
    useLocations?: boolean;
    overrides?: Record<string, number>;
  };
  instanceLayout?: InstanceDataLayout;
}

/**
 * Every plugin runs a phase before any plugin starts the next, so `preCompile` sees everything collected
 * @internal
 */
export interface ShaderCompilerPlugin {
  collectData?(context: ShaderCompilerContext): void;
  preCompile?(context: ShaderCompilerContext): void;
  /** Returns code keyed by slot name; code for one slot from several plugins joins in plugin order */
  injectCode?(context: ShaderCompilerContext): Record<string, string>;
}
