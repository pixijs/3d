import { warn } from 'pixi.js';

import type { InstanceDataLayout } from '../../batcher/instanceDataLayout';
import { DEFAULT_OUTPUT_LOCATIONS } from '../../shader/codegen/collectFragmentOutputs';
import { compileShader } from '../../shader/compileShader';
import { resolveShaderBits } from '../../shader/resolveShaderBits';
import type { ShaderBit } from '../../shader/ShaderBit';
import type { ShaderBitTemplate } from '../../shader/ShaderBitTemplate';
import type { ShaderCompilerContext, ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';
import { glslAttributesPlugin } from './glslAttributesPlugin';
import { glslBindingsPlugin } from './glslBindingsPlugin';
import { glslFragmentOutputsPlugin } from './glslFragmentOutputsPlugin';
import { glslGroupMapPlugin } from './glslGroupMapPlugin';
import { glslHeadersPlugin } from './glslHeadersPlugin';
import { glslInterStagePlugin } from './glslInterStagePlugin';
import { glslOverridesPlugin } from './glslOverridesPlugin';
import { glslPrecisionPlugin } from './glslPrecisionPlugin';
import { glslStageSlotsPlugin } from './glslStageSlotsPlugin';
import { instanceAccessPluginGl } from './instanceAccessPluginGl';

/** @internal */
export interface CompileGlslSourceOptions {
  /**
   * `true` fails to compile once the shader has a varying: GLSL ES 3.00 takes locations only on vertex inputs and
   * fragment outputs
   * @default true
   */
  useLocations?: boolean;

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

interface CompileGlslResult {
  vertex: string;
  fragment: string;
  structs: Record<string, Record<string, string>>;
  groupMap: Record<number, Record<number, string>>;
  bits: ShaderBit[];
}

interface CompileGlslOptions extends CompileGlslSourceOptions {
  bits: ShaderBit[];
  template: ShaderBitTemplate;
  extraPlugins?: ShaderCompilerPlugin[];
  instanceLayout?: InstanceDataLayout;
  outputLocations?: readonly string[];
}

/**
 * The fragment stage reuses the vertex stage's `context.data`, so both declare what the plugins collected once. The
 * default plugins start with `instanceAccessPluginGl`, so the bit it adds reaches the rest.
 * @internal
 */
export function compileGlslSource(options: CompileGlslOptions): CompileGlslResult {
  const {
    bits,
    template,
    extraPlugins,
    instanceLayout,
    outputLocations = DEFAULT_OUTPUT_LOCATIONS,
    ...glslOptions
  } = options;
  const resolvedBits = resolveShaderBits(bits);
  const defaultPlugins = [
    instanceAccessPluginGl,
    glslPrecisionPlugin,
    glslGroupMapPlugin,
    glslOverridesPlugin,
    glslBindingsPlugin,
    glslInterStagePlugin,
    glslFragmentOutputsPlugin,
    glslAttributesPlugin,
    glslHeadersPlugin,
    glslStageSlotsPlugin,
  ];
  const plugins = extraPlugins ? [...extraPlugins, ...defaultPlugins] : defaultPlugins;

  const vertexContext: ShaderCompilerContext = {
    bits: resolvedBits,
    template,
    templateString: template.gl!.vertex,
    data: {},
    stage: 'vertex',
    glslOptions,
    instanceLayout,
    outputLocations,
  };
  const vertex = compileShader(vertexContext, plugins);

  warnMissingHeaderSlot(template.gl!.vertex, vertexContext.data.headers!.join(''), 'vertex');

  const fragmentContext: ShaderCompilerContext = {
    bits: resolvedBits,
    template,
    templateString: template.gl!.fragment,
    data: vertexContext.data,
    stage: 'fragment',
    glslOptions,
    instanceLayout,
    outputLocations,
  };
  const fragment = compileShader(fragmentContext, plugins);

  warnMissingHeaderSlot(template.gl!.fragment, fragmentContext.data.headers!.join(''), 'fragment');

  return {
    vertex,
    fragment,
    structs: (fragmentContext.data.structs as Record<string, Record<string, string>>) ?? {},
    groupMap: fragmentContext.data.groupMap!,
    bits: fragmentContext.bits,
  };
}
