import { warn } from 'pixi.js';

import type { ShaderBit, InterStageType } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';
import { WGSL_TO_GLSL_TYPE } from './wgslToGlsl';

const BUILTIN_NAMES = new Set(['position', 'frontFacing', 'sampleIndex', 'sampleMask']);

function needsFlatQualifier(type: InterStageType): boolean {
  return type === 'i32' || type === 'u32' || type.includes('<i32>') || type.includes('<u32>');
}

function toGlslType(interStageType: InterStageType): string {
  const mapped = WGSL_TO_GLSL_TYPE[interStageType];
  if (!mapped) {
    warn(`[compileInterStageGlsl] Unknown inter-stage type: "${interStageType}"`);
    return 'vec4';
  }
  return mapped;
}

function warnInterStageConflict(name: string, newType: string, existingType: string): void {
  warn(
    `[compileInterStageGlsl] Inter-stage variable "${name}" redefined with different type: ` +
      `"${existingType}" → "${newType}". Keeping original.`,
  );
}

interface CompileInterStageGlslOptions {
  useLocations?: boolean;
}

interface CompileInterStageGlslResult {
  vertex: string;
  fragment: string;
}

function compileInterStageGlsl(
  bits: ShaderBit[],
  options: CompileInterStageGlslOptions = {},
): CompileInterStageGlslResult {
  const { useLocations = true } = options;

  const interStage = new Map<string, InterStageType>();

  for (const bit of bits) {
    if (!bit.interStage) continue;

    for (const [name, type] of Object.entries(bit.interStage)) {
      if (BUILTIN_NAMES.has(name)) continue;

      if (!interStage.has(name)) {
        interStage.set(name, type);
      } else if (interStage.get(name) !== type) {
        warnInterStageConflict(name, type, interStage.get(name)!);
      }
    }
  }

  const vertexOut: string[] = [];
  let locationIndex = 0;

  for (const [name, type] of interStage) {
    const glslType = toGlslType(type);
    const flat = needsFlatQualifier(type) ? 'flat ' : '';

    if (useLocations) {
      vertexOut.push(`layout(location = ${locationIndex++}) ${flat}out ${glslType} ${name};`);
    } else {
      vertexOut.push(`${flat}out ${glslType} ${name};`);
    }
  }

  const fragmentIn: string[] = [];
  locationIndex = 0;

  for (const [name, type] of interStage) {
    const glslType = toGlslType(type);
    const flat = needsFlatQualifier(type) ? 'flat ' : '';

    if (useLocations) {
      fragmentIn.push(`layout(location = ${locationIndex++}) ${flat}in ${glslType} ${name};`);
    } else {
      fragmentIn.push(`${flat}in ${glslType} ${name};`);
    }
  }

  return {
    vertex: vertexOut.join('\n'),
    fragment: fragmentIn.join('\n'),
  };
}

/** @internal */
export const glslInterStagePlugin: ShaderCompilerPlugin = {
  collectData(context) {
    const glsl = (context.data.glsl ??= {});
    glsl.interStage ??= compileInterStageGlsl(context.bits, {
      useLocations: context.glslOptions?.useLocations,
    });
  },
  injectCode(context) {
    const interStage = context.data.glsl!.interStage!;
    return { header: context.stage === 'vertex' ? interStage.vertex : interStage.fragment };
  },
};
