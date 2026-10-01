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

/**
 * Options controlling how GLSL uniforms, locations, and overrides are emitted
 * @internal
 */
export interface CompileGlslSourceOptions {
  /** Groups to declare as `std140` uniform blocks; any other group's fields become plain uniforms */
  uboGroups?: Set<string> | string[];

  /**
   * Whether to declare `layout(location = n)` on attributes and inter-stage variables
   *
   * Every caller passes `false`. GLSL ES 3.00 only accepts locations on vertex inputs and
   * fragment outputs, so `true` fails to compile once the shader has an inter-stage variable.
   * @default true
   */
  useLocations?: boolean;

  /**
   * Override values, baked into the header as `#define KEY VALUE` by `glslOverridesPlugin`
   *
   * GLSL ES 3.00 has no specialization constants, so where WebGPU applies overrides when it builds
   * the pipeline, WebGL compiles one program per set of values.
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
  /** Plugins that run before the defaults, such as `texturesPluginGl` */
  extraPlugins?: ShaderCompilerPlugin[];
}

/**
 * Compiles GLSL vertex + fragment sources from bits + template using the
 * default GLSL plugins
 *
 * Compiles the vertex stage, then the fragment stage, sharing `context.data` between them, so
 * what the plugins collect once (bindings, inter-stage variables, the group map) matches in both.
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
