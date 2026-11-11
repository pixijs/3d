import { collectFragmentOutputs } from '../../shader/codegen/collectFragmentOutputs';
import type { FragmentOutputType } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';
import { WGSL_TO_GLSL_TYPE } from './wgslToGlsl';

const WRITE_SLOT = '{{writeOutputs}}';

/** The `frag` prefix keeps the `out` variable apart from a bit's local of the same name, such as `color` */
function outName(name: string): string {
  return `frag${name[0].toUpperCase()}${name.slice(1)}`;
}

function emitDeclarations(declared: Record<string, FragmentOutputType>, locations: readonly string[]): string {
  const out: string[] = ['struct Outputs {'];

  for (const name in declared) out.push(`  ${WGSL_TO_GLSL_TYPE[declared[name]]} ${name};`);
  out.push('};', '');
  for (let i = 0; i < locations.length; i++) {
    if (!declared[locations[i]]) continue;
    out.push(`layout(location = ${i}) out ${WGSL_TO_GLSL_TYPE[declared[locations[i]]]} ${outName(locations[i])};`);
  }

  return out.join('\n');
}

/**
 * Acts only on a fragment template with `{{writeOutputs}}`. The `outputs` local starts zeroed, since GLSL leaves a
 * local struct undefined where WGSL zeroes its `var`.
 * @internal
 */
export const glslFragmentOutputsPlugin: ShaderCompilerPlugin = {
  collectData(context) {
    if (!context.templateString.includes(WRITE_SLOT)) return;

    context.data.outputs = collectFragmentOutputs(context.bits);
  },
  injectCode(context): Record<string, string> {
    const declared = context.data.outputs;

    if (!declared) return {};

    const locations = context.outputLocations;
    const zeros: string[] = [];
    const writes: string[] = [];

    for (const name in declared) zeros.push(`${WGSL_TO_GLSL_TYPE[declared[name]]}(0)`);
    for (let i = 0; i < locations.length; i++) {
      if (declared[locations[i]]) writes.push(`${outName(locations[i])} = outputs.${locations[i]};`);
    }

    return {
      header: emitDeclarations(declared, locations),
      declareOutputs: `Outputs outputs = Outputs(${zeros.join(', ')});`,
      writeOutputs: writes.join('\n'),
    };
  },
};
