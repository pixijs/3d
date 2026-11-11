import { extractStructAndGroups, generateGpuLayoutGroups, ShaderStage } from 'pixi.js';

import type { InstanceDataLayout } from '../../batcher/instanceDataLayout';
import { DEFAULT_OUTPUT_LOCATIONS } from '../../shader/codegen/collectFragmentOutputs';
import { bindingFields, bindingVisibility } from '../../shader/codegen/parseBindingType';
import { compileShader } from '../../shader/compileShader';
import { resolveShaderBits } from '../../shader/resolveShaderBits';
import type { ShaderBit, StructDefinition } from '../../shader/ShaderBit';
import type { ShaderBitTemplate } from '../../shader/ShaderBitTemplate';
import type { ShaderCompilerContext, ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';
import { instanceAccessPlugin } from './instanceAccessPlugin';
import { wgslAttributesPlugin } from './wgslAttributesPlugin';
import { wgslBindingsPlugin } from './wgslBindingsPlugin';
import { wgslFragmentOutputsPlugin } from './wgslFragmentOutputsPlugin';
import { wgslHeadersPlugin } from './wgslHeadersPlugin';
import { wgslInterStagePlugin } from './wgslInterStagePlugin';
import { wgslOverridesPlugin } from './wgslOverridesPlugin';
import { wgslStageSlotsPlugin } from './wgslStageSlotsPlugin';

interface CompileWgslSourceOptions {
  bits: ShaderBit[];
  template: ShaderBitTemplate;
  extraPlugins?: ShaderCompilerPlugin[];
  instanceLayout?: InstanceDataLayout;
  outputLocations?: readonly string[];
}

interface CompileWgslResult {
  vertex: { source: string; entryPoint: string };
  fragment: { source: string; entryPoint: string };
  structs: Record<string, StructDefinition>;
  gpuLayout: ReturnType<typeof generateGpuLayoutGroups>;
  /** The bits compiled: the listed ones, the ones they require, and any a plugin added */
  bits: ShaderBit[];
}

/**
 * Narrows each binding a bit tags `'vertex'` or `'fragment'` to that stage, so it counts against only that
 * stage's limits; the first bit to declare a binding sets its tag, as it sets its type in `collectBindings`
 */
function narrowGpuLayout(source: string, bits: ShaderBit[]): ReturnType<typeof generateGpuLayoutGroups> {
  const parsed = extractStructAndGroups(source);
  const layout = generateGpuLayoutGroups(parsed);

  const tags: Record<string, ReturnType<typeof bindingVisibility>> = Object.create(null);
  for (const bit of bits) {
    if (!bit.bindings) continue;
    for (const [groupName, group] of Object.entries(bit.bindings)) {
      if (!group) continue;
      for (const { name, spec } of bindingFields(group, groupName)) {
        if (!(name in tags)) tags[name] = bindingVisibility(spec);
      }
    }
  }

  for (const g of parsed.groups) {
    const tag = tags[g.name];
    if (!tag || tag === 'both') continue;
    const entry = layout[g.group]?.find((e) => e.binding === g.binding);
    if (entry) entry.visibility = tag === 'vertex' ? ShaderStage.VERTEX : ShaderStage.FRAGMENT;
  }

  return layout;
}

/**
 * Turns off `derivative_uniformity`, since the merged form's `material` is uniform but not provably so;
 * bits must keep `textureSample`, `dpdx` and `dpdy` in uniform control flow themselves
 */
const WGSL_DIRECTIVE = 'diagnostic(off, derivative_uniformity);\n';

/**
 * Runs `instanceAccessPlugin` after any `extraPlugins` but before the default plugins, so the defaults
 * collect the bit it adds
 * @internal
 */
export function compileWgslSource(options: CompileWgslSourceOptions): CompileWgslResult {
  const { bits, template, extraPlugins, instanceLayout, outputLocations = DEFAULT_OUTPUT_LOCATIONS } = options;
  const defaultPlugins = [
    instanceAccessPlugin,
    wgslOverridesPlugin,
    wgslBindingsPlugin,
    wgslAttributesPlugin,
    wgslInterStagePlugin,
    wgslFragmentOutputsPlugin,
    wgslHeadersPlugin,
    wgslStageSlotsPlugin,
  ];
  const plugins = extraPlugins ? [...extraPlugins, ...defaultPlugins] : defaultPlugins;

  const resolvedBits = resolveShaderBits(bits);

  const context: ShaderCompilerContext = {
    bits: resolvedBits,
    template,
    templateString: template.gpu!,
    data: {},
    instanceLayout,
    outputLocations,
  };
  const source = `${WGSL_DIRECTIVE}${compileShader(context, plugins)}`;

  return {
    vertex: { source, entryPoint: 'mainVertex' },
    fragment: { source, entryPoint: 'mainFragment' },
    structs: context.data.structs || {},
    gpuLayout: narrowGpuLayout(source, context.bits),
    bits: context.bits,
  };
}
