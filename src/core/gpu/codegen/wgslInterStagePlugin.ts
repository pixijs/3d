import { warn } from 'pixi.js';

import type { ShaderBit, InterStageType } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

const BUILTIN_NAMES = new Set(['position', 'frontFacing', 'sampleIndex', 'sampleMask']);

function needsFlatInterpolation(type: InterStageType): boolean {
  return type === 'i32' || type === 'u32' || type.includes('<i32>') || type.includes('<u32>');
}

function warnInterStageConflict(name: string, newType: string, existingType: string): void {
  warn(
    `[compileInterStageWgsl] Inter-stage variable "${name}" redefined with different type: ` +
      `"${existingType}" → "${newType}". Keeping original.`,
  );
}

function collectInterStage(bits: ShaderBit[]): Record<string, InterStageType> {
  const interStage: Record<string, InterStageType> = Object.create(null);

  for (const bit of bits) {
    if (!bit.interStage) continue;

    for (const [name, type] of Object.entries(bit.interStage)) {
      if (BUILTIN_NAMES.has(name)) continue;

      if (!(name in interStage)) {
        interStage[name] = type;
      } else if (interStage[name] !== type) {
        warnInterStageConflict(name, type, interStage[name]);
      }
    }
  }

  return interStage;
}

function emitInterStageWgsl(interStage: Record<string, InterStageType>): string {
  const out: string[] = [];
  const names = Object.keys(interStage);

  out.push('struct VertexOutput {');
  out.push('  @builtin(position) position: vec4<f32>,');

  let locationIndex = 0;
  for (const name of names) {
    const type = interStage[name];
    const interpolate = needsFlatInterpolation(type) ? ' @interpolate(flat)' : '';
    out.push(`  @location(${locationIndex++})${interpolate} ${name}: ${type},`);
  }
  out.push('}');

  out.push('');

  out.push('struct FragmentInput {');
  out.push('  @builtin(position) position: vec4<f32>,');
  out.push('  @builtin(front_facing) frontFacing: bool,');

  locationIndex = 0;
  for (const name of names) {
    const type = interStage[name];
    const interpolate = needsFlatInterpolation(type) ? ' @interpolate(flat)' : '';
    out.push(`  @location(${locationIndex++})${interpolate} ${name}: ${type},`);
  }
  out.push('}');

  return out.join('\n');
}

/** @internal */
export const wgslInterStagePlugin: ShaderCompilerPlugin = {
  collectData(context) {
    context.data.interStage = collectInterStage(context.bits);
  },
  injectCode(context) {
    const interStageSource = emitInterStageWgsl(context.data.interStage!);
    return { header: interStageSource };
  },
};
