import { warn } from 'pixi.js';

import { compileShader } from '../../shader/compileShader';
import type { ShaderBit } from '../../shader/ShaderBit';
import type { ShaderBitTemplate } from '../../shader/ShaderBitTemplate';
import type { ShaderCompilerContext, ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';
import { glslAttributesPlugin } from './glslAttributesPlugin';
import { glslBindingsPlugin } from './glslBindingsPlugin';
import { glslGroupMapPlugin } from './glslGroupMapPlugin';
import { glslHeadersPlugin } from './glslHeadersPlugin';
import { glslInterStagePlugin } from './glslInterStagePlugin';
import { glslOverridesPlugin } from './glslOverridesPlugin';
import { glslPrecisionPlugin } from './glslPrecisionPlugin';
import { glslStageSlotsPlugin } from './glslStageSlotsPlugin';
import { glslStorageAccessPlugin } from './glslStorageAccessPlugin';

/**
 * Options controlling how GLSL uniforms, locations, and overrides are emitted
 * @internal
 */
export interface CompileGlslSourceOptions {
  /** Groups to compile as UBOs (WebGL2 uniform buffer objects); groups not in this set compile as flat uniforms */
  uboGroups?: Set<string> | string[];

  /**
   * Whether to include explicit layout(location) declarations for attributes and inter-stage variables
   * @default true (WebGL2 style)
   */
  useLocations?: boolean;

  /**
   * Runtime override values, read by `glslOverridesPlugin` and baked into
   * the GLSL header as `#define KEY VALUE`. Mirrors `descriptor.overrides`
   * on the WGSL path but the substitution happens at compile time, since
   * GLSL has no specialization-constant equivalent.
   */
  overrides?: Record<string, number>;
}

function warnMissingHeaderSlot(templateSource: string, headerSource: string, stage: 'vertex' | 'fragment'): void {
  if (headerSource && /\S/.test(headerSource) && !templateSource.includes('{{header}}')) {
    warn(
      `[compileShader] ${stage === 'vertex' ? 'Vertex' : 'Fragment'} template missing {{header}} slot - ` +
        'bindings, attributes, and inter-stage variables will not be injected.',
    );
  }
}

/**
 * Compiled GLSL sources plus the metadata `Shader.from()` needs to bind them
 * @internal
 */
interface CompileGlslResult {
  /** Compiled vertex shader source */
  vertex: string;
  /** Compiled fragment shader source */
  fragment: string;
  /** Resolved group struct definitions (e.g. `{ Material: { baseColor: 'vec4<f32>', ... } }`) */
  structs: Record<string, Record<string, string>>;
  /** Maps WebGL bind group/binding indices to uniform names for `Shader.from()` */
  groupMap: Record<number, Record<number, string>>;
}

/**
 * Full input to `compileGlslSource`: the bits and template to compile plus the
 * GLSL emission options
 * @internal
 */
interface CompileGlslOptions extends CompileGlslSourceOptions {
  /** Shader bits to compile */
  bits: ShaderBit[];
  /** Template defining bind groups and vertex/fragment GLSL sources */
  template: ShaderBitTemplate;
  /** Optional plugins prepended before the defaults (e.g. batch texture plugin) */
  extraPlugins?: ShaderCompilerPlugin[];
}

/**
 * Compiles GLSL vertex + fragment sources from bits + template using the
 * default GLSL plugins
 *
 * Handles the two-pass compilation (vertex then fragment) and shares data
 * between passes.
 * @param options - Bits, template, and GLSL emission options
 * @returns Compiled sources plus struct/group metadata
 * @internal
 */
export function compileGlslSource(options: CompileGlslOptions): CompileGlslResult {
  const { bits, template, extraPlugins, ...glslOptions } = options;
  const defaultPlugins = [
    glslPrecisionPlugin,
    glslGroupMapPlugin,
    glslOverridesPlugin,
    glslBindingsPlugin,
    glslStorageAccessPlugin,
    glslInterStagePlugin,
    glslAttributesPlugin,
    glslHeadersPlugin,
    glslStageSlotsPlugin,
  ];
  const plugins = extraPlugins ? [...extraPlugins, ...defaultPlugins] : defaultPlugins;

  const vertexContext: ShaderCompilerContext = {
    bits,
    template,
    templateString: template.gl!.vertex,
    data: {},
    stage: 'vertex',
    glslOptions,
  };
  const vertex = compileShader(vertexContext, plugins);

  warnMissingHeaderSlot(template.gl!.vertex, vertexContext.data.headers!.join(''), 'vertex');

  const fragmentContext: ShaderCompilerContext = {
    bits,
    template,
    templateString: template.gl!.fragment,
    data: vertexContext.data,
    stage: 'fragment',
    glslOptions,
  };
  const fragment = compileShader(fragmentContext, plugins);

  warnMissingHeaderSlot(template.gl!.fragment, fragmentContext.data.headers!.join(''), 'fragment');

  return {
    vertex,
    fragment,
    structs: (fragmentContext.data.structs as Record<string, Record<string, string>>) ?? {},
    groupMap: fragmentContext.data.groupMap!,
  };
}
