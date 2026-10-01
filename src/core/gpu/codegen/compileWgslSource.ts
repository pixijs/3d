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
   * (WebGPU's default `maxStorageBuffersPerShaderStage` is 8). Untagged bindings
   * keep `VERTEX | FRAGMENT`, as pixi would generate them.
   */
  gpuLayout: ReturnType<typeof generateGpuLayoutGroups>;
}

/**
 * Builds the WebGPU bind-group layout for `source` and narrows each entry whose
 * binding a bit tagged with a single stage
 *
 * The base layout is pixi's own default, derived from the WGSL: every binding
 * `VERTEX | FRAGMENT`, and each texture's sample type from its texel type. Only the
 * `visibility` of bindings tagged `'vertex'` or `'fragment'` changes, matched by the
 * binding number parsed from the source.
 *
 * A binding's tag comes from the first bit that declares it, the rule `collectBindings` follows
 * for its type. Tags are keyed by binding name, which WGSL keeps unique across the module.
 * @param source - The compiled WGSL source whose bindings the layout describes
 * @param bits - The bits whose per-binding stage tags narrow the layout
 */
function narrowGpuLayout(source: string, bits: ShaderBit[]): ReturnType<typeof generateGpuLayoutGroups> {
  const parsed = extractStructAndGroups(source);
  const layout = generateGpuLayoutGroups(parsed);

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
 * The directive every module starts with
 *
 * `textureSample` takes its level of detail from derivatives. WGSL reports the
 * `derivative_uniformity` diagnostic as an error by default when a derivative sits in control flow
 * the compiler cannot prove uniform. The batch samplers branch on a flat varying, uniform across
 * every quad but not provably so, and this directive turns that diagnostic off. It is off for the
 * whole module, so no bit compiled here gets that check. A bit's own `textureSample`, `dpdx`,
 * `dpdy` and the other derivative builtins must stay in uniform control flow. `textureSampleLevel`
 * and `textureSampleGrad` take no derivative, so they may sit in any branch.
 */
const WGSL_DIRECTIVE = 'diagnostic(off, derivative_uniformity);\n';

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
  const source = `${WGSL_DIRECTIVE}${compileShader(context, plugins)}`;

  return {
    vertex: { source, entryPoint: 'mainVertex' },
    fragment: { source, entryPoint: 'mainFragment' },
    structs: context.data.structs || {},
    gpuLayout: narrowGpuLayout(source, bits),
  };
}
