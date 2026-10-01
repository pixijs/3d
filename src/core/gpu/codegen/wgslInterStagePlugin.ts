import { warn } from 'pixi.js';

import type { ShaderBit, InterStageType } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/**
 * Builtin names a bit's `interStage` may list but that never become `@location` varyings
 *
 * The emitted structs declare `position` and `frontFacing` themselves; `sampleIndex` and
 * `sampleMask` are skipped and not declared.
 */
const BUILTIN_NAMES = new Set(['position', 'frontFacing', 'sampleIndex', 'sampleMask']);

/**
 * Whether an inter-stage type must be `@interpolate(flat)`, which WGSL requires of every integer
 * scalar or vector
 * @param type - The varying's WGSL type
 */
function needsFlatInterpolation(type: InterStageType): boolean {
  return type === 'i32' || type === 'u32' || type.includes('<i32>') || type.includes('<u32>');
}

function warnInterStageConflict(name: string, newType: string, existingType: string): void {
  warn(
    `[compileInterStageWgsl] Inter-stage variable "${name}" redefined with different type: ` +
      `"${existingType}" → "${newType}". Keeping original.`,
  );
}

/**
 * Collects deduplicated inter-stage variables from shader bits as a plain object
 *
 * Names in `BUILTIN_NAMES` are skipped. A variable redefined with a different type warns and keeps
 * the original.
 * @param bits - Shader bits to scan for `interStage` declarations
 * @returns Map of inter-stage variable name to its WGSL type
 * @internal
 */
function collectInterStage(bits: ShaderBit[]): Record<string, InterStageType> {
  const interStage: Record<string, InterStageType> = Object.create(null);

  for (const bit of bits) {
    if (!bit.interStage) continue;

    for (const [name, type] of Object.entries(bit.interStage)) {
      if (BUILTIN_NAMES.has(name)) continue;

      if (!(name in interStage)) {
        interStage[name] = type as InterStageType;
      } else if (interStage[name] !== type) {
        warnInterStageConflict(name, type, interStage[name]);
      }
    }
  }

  return interStage;
}

/**
 * Generates WGSL `struct VertexOutput { ... }` and `struct FragmentInput { ... }` from collected
 * inter-stage data
 * @param interStage - Deduplicated inter-stage variables from `collectInterStage`
 * @returns WGSL source declaring both structs
 * @internal
 */
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

/**
 * Emits the inter-stage `VertexOutput` / `FragmentInput` structs into the template's `{{header}}` slot
 * @internal
 */
export const wgslInterStagePlugin: ShaderCompilerPlugin = {
  collectData(context) {
    context.data.interStage = collectInterStage(context.bits);
  },
  injectCode(context) {
    const interStageSource = emitInterStageWgsl(context.data.interStage!);
    return { header: interStageSource };
  },
};
