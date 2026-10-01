import { warn } from 'pixi.js';

import type { ShaderBit, InterStageType } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/** Maps WGSL inter-stage types to GLSL types */
const INTERSTAGE_TO_GLSL: Record<InterStageType, string> = {
  f32: 'float',
  i32: 'int',
  u32: 'uint',

  'vec2<f32>': 'vec2',
  'vec3<f32>': 'vec3',
  'vec4<f32>': 'vec4',

  'vec2<i32>': 'ivec2',
  'vec3<i32>': 'ivec3',
  'vec4<i32>': 'ivec4',

  'vec2<u32>': 'uvec2',
  'vec3<u32>': 'uvec3',
  'vec4<u32>': 'uvec4',
};

/** Inter-stage names that stand for WGSL builtins; GLSL code reads its own `gl_*` variables instead */
const BUILTIN_NAMES = new Set(['position', 'frontFacing', 'sampleIndex', 'sampleMask']);

/**
 * Whether an inter-stage type must be `flat`: GLSL ES 3.00 and WGSL both reject interpolating an
 * integer scalar or vector
 * @param type - The inter-stage type
 */
function needsFlatQualifier(type: InterStageType): boolean {
  return type === 'i32' || type === 'u32' || type.includes('<i32>') || type.includes('<u32>');
}

function toGlslType(interStageType: InterStageType): string {
  const mapped = INTERSTAGE_TO_GLSL[interStageType];
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

/**
 * Options for `compileInterStageGlsl`
 * @internal
 */
interface CompileInterStageGlslOptions {
  /**
   * Whether to declare `layout(location = n)` on each variable, which GLSL ES 3.00 rejects on
   * inter-stage variables; see `CompileGlslSourceOptions.useLocations`
   * @default true
   */
  useLocations?: boolean;
}

/**
 * Result of `compileInterStageGlsl`: matching declaration blocks for the two
 * stages
 * @internal
 */
interface CompileInterStageGlslResult {
  /** Vertex shader inter-stage declarations (out) */
  vertex: string;
  /** Fragment shader inter-stage declarations (in) */
  fragment: string;
}

/**
 * Compiles shader inter-stage variables from bits into GLSL declarations
 *
 * Declares each variable once, as an `out` in the vertex stage and a matching `in` in the
 * fragment stage, in the order the bits first name them. A later bit naming it with another type
 * warns and keeps the first.
 *
 * Names in `BUILTIN_NAMES` get no declaration. Of those, GLSL ES 3.00 has `gl_Position` and
 * `gl_FrontFacing`; it has no equivalent of `sampleIndex` or `sampleMask`.
 * @param bits - Array of shader bits containing inter-stage definitions
 * @param options - Optional settings
 * @returns Object with vertex and fragment shader declarations
 * @internal
 */
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
        interStage.set(name, type as InterStageType);
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

/**
 * GLSL compiler plugin that compiles inter-stage declarations once and injects
 * the `out` block into the vertex header and the `in` block into the fragment
 * header
 * @internal
 */
export const glslInterStagePlugin: ShaderCompilerPlugin = {
  collectData(context) {
    if (!context.data.interStage) {
      context.data.interStage = compileInterStageGlsl(context.bits, {
        useLocations: context.glslOptions?.useLocations,
      }) as any;
    }
  },
  injectCode(context) {
    const interStage = context.data.interStage as any;
    return { header: context.stage === 'vertex' ? interStage.vertex : interStage.fragment };
  },
};
