import { extractStructAndGroups, generateGpuLayoutGroups, ShaderStage } from 'pixi.js';

import { bindingVisibility } from '../../shader/codegen/parseBindingType';
import { compileShader } from '../../shader/compileShader';
import type { ShaderBit, StructDefinition } from '../../shader/ShaderBit';
import type { ShaderBitTemplate } from '../../shader/ShaderBitTemplate';
import type { ShaderCompilerContext, ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';
import { wgslAttributesPlugin } from './wgslAttributesPlugin';
import { wgslBindingsPlugin } from './wgslBindingsPlugin';
import { wgslHeadersPlugin } from './wgslHeadersPlugin';
import { wgslInterStagePlugin } from './wgslInterStagePlugin';
import { wgslOverridesPlugin } from './wgslOverridesPlugin';
import { wgslStageSlotsPlugin } from './wgslStageSlotsPlugin';

/**
 * Input to `compileWgslSource`: the bits and template to compile
 * @internal
 */
interface CompileWgslSourceOptions {
  /** Shader bits to compile */
  bits: ShaderBit[];
  /** Template defining bind groups and WGSL source */
  template: ShaderBitTemplate;
  /** Optional plugins prepended before the defaults (e.g. batch texture plugin) */
  extraPlugins?: ShaderCompilerPlugin[];
}

/**
 * Compiled WGSL stages plus the metadata `Shader.from()` and `GpuProgram` need
 * @internal
 */
interface CompileWgslResult {
  /** Vertex stage: the shared WGSL source and its entry point */
  vertex: { source: string; entryPoint: string };
  /** Fragment stage: the shared WGSL source and its entry point */
  fragment: { source: string; entryPoint: string };
  /** Resolved group struct definitions (e.g. `{ Material: { baseColor: 'vec4<f32>', ... } }`) */
  structs: Record<string, StructDefinition>;
  /**
   * Bind-group layout with per-stage `visibility` narrowed from the bits'
   * `{ type, visibility }` binding tags. Passed to `GpuProgram` so a storage
   * buffer read in only one stage spends a slot in only that stage's budget
   * (WebGPU caps `maxStorageBuffersPerShaderStage`). Untagged bindings default
   * to `VERTEX | FRAGMENT`, exactly as pixi would auto-generate.
   */
  gpuLayout: ReturnType<typeof generateGpuLayoutGroups>;
}

/**
 * Builds the WebGPU bind-group layout for `source` and narrows each entry whose
 * binding a bit tagged with a single stage
 *
 * The base layout is pixi's own default (every binding `VERTEX | FRAGMENT`); we
 * only edit the `visibility` of bindings tagged `'vertex'` / `'fragment'`,
 * matching entries by their parsed binding number so the narrowing tracks the
 * same indices the source declares.
 * @param source - The compiled WGSL source whose bindings the layout describes
 * @param bits - The bits whose per-binding stage tags narrow the layout
 */
function narrowGpuLayout(source: string, bits: ShaderBit[]): ReturnType<typeof generateGpuLayoutGroups> {
  const parsed = extractStructAndGroups(source);
  const layout = generateGpuLayoutGroups(parsed);

  // Collect per-binding stage tags across the bits (first declaration wins,
  // matching the binding collectors). Keyed by binding name — names are unique.
  const tags: Record<string, ReturnType<typeof bindingVisibility>> = Object.create(null);
  for (const bit of bits) {
    if (!bit.bindings) continue;
    for (const group of Object.values(bit.bindings)) {
      if (!group) continue;
      for (const [name, spec] of Object.entries(group)) {
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
 * Compiles a WGSL shader source from bits + template using the default WGSL
 * plugins
 * @param options - Bits and template to compile
 * @returns The `gpu` object expected by `Shader.from()`, plus struct and
 * bind-group-layout metadata
 * @internal
 */
export function compileWgslSource(options: CompileWgslSourceOptions): CompileWgslResult {
  const { bits, template, extraPlugins } = options;
  const defaultPlugins = [
    wgslOverridesPlugin,
    wgslBindingsPlugin,
    wgslAttributesPlugin,
    wgslInterStagePlugin,
    wgslHeadersPlugin,
    wgslStageSlotsPlugin,
  ];
  const plugins = extraPlugins ? [...extraPlugins, ...defaultPlugins] : defaultPlugins;

  const context: ShaderCompilerContext = {
    bits,
    template,
    templateString: template.gpu!,
    data: {},
  };
  const source = compileShader(context, plugins);

  return {
    vertex: { source, entryPoint: 'mainVertex' },
    fragment: { source, entryPoint: 'mainFragment' },
    structs: context.data.structs || {},
    gpuLayout: narrowGpuLayout(source, bits),
  };
}
