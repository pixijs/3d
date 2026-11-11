import { collectFragmentOutputs } from '../../shader/codegen/collectFragmentOutputs';
import type { FragmentOutputType } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

const WRITE_SLOT = '{{fragmentWriteOutputs}}';

/** Leaves a location no bit declares free, so the draw keeps that attachment and later outputs line up */
function emitStructs(declared: Record<string, FragmentOutputType>, locations: readonly string[]): string {
  const out: string[] = ['struct Outputs {'];

  for (const name in declared) out.push(`  ${name}: ${declared[name]},`);
  out.push('}', '', 'struct FragmentOutput {');
  for (let i = 0; i < locations.length; i++) {
    if (declared[locations[i]]) out.push(`  @location(${i}) ${locations[i]}: ${declared[locations[i]]},`);
  }
  out.push('}');

  return out.join('\n');
}

/**
 * Builds `FragmentOutput` from `outputs` field by field, since some mobile GPUs misread a struct
 * passed to a function by value
 * @internal
 */
export const wgslFragmentOutputsPlugin: ShaderCompilerPlugin = {
  collectData(context) {
    if (!context.templateString.includes(WRITE_SLOT)) return;

    context.data.outputs = collectFragmentOutputs(context.bits);
  },
  injectCode(context): Record<string, string> {
    const declared = context.data.outputs;

    if (!declared) return {};

    const locations = context.outputLocations;

    return {
      header: emitStructs(declared, locations),
      fragmentDeclareOutputs: 'var outputs: Outputs;',
      fragmentWriteOutputs: `return FragmentOutput(${locations
        .filter((name) => declared[name])
        .map((name) => `outputs.${name}`)
        .join(', ')});`,
    };
  },
};
