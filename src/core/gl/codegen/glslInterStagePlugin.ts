import { warn } from 'pixi.js';

import type { ShaderBit, InterStageType } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/** Maps WGSL inter-stage types to GLSL types */
const INTERSTAGE_TO_GLSL: Record<InterStageType, string> = {
  // Scalars
  f32: 'float',
  i32: 'int',
  u32: 'uint',

  // Float vectors
  'vec2<f32>': 'vec2',
  'vec3<f32>': 'vec3',
  'vec4<f32>': 'vec4',

  // Integer vectors
  'vec2<i32>': 'ivec2',
  'vec3<i32>': 'ivec3',
  'vec4<i32>': 'ivec4',

  // Unsigned integer vectors
  'vec2<u32>': 'uvec2',
  'vec3<u32>': 'uvec3',
  'vec4<u32>': 'uvec4',
};

/** Reserved builtin names - these are NOT user inter-stage variables (use gl_* instead) */
const BUILTIN_NAMES = new Set(['position', 'frontFacing', 'sampleIndex', 'sampleMask']);

function needsFlatQualifier(type: InterStageType): boolean {
  // GLSL requires integer varyings to be declared 'flat' between stages.
  // Applies to scalars and vectors of int/uint (i32/u32 in our type system).
  // This mirrors the WGSL requirement and keeps cross-backend behavior consistent.
  return type === 'i32' || type === 'u32' || type.includes('<i32>') || type.includes('<u32>');
}

function toGlslType(interStageType: InterStageType): string {
  const mapped = INTERSTAGE_TO_GLSL[interStageType];
  if (!mapped) {
    warn(`[compileInterStageGlsl] Unknown inter-stage type: "${interStageType}"`);
    return 'vec4'; // fallback
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
   * Whether to include explicit layout(location) declarations
   * @default true (WebGL2 style)
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
 * - Skips builtin names (use gl_Position, gl_FrontFacing, etc. directly)
 * - Deduplicates user inter-stage variables across bits (warns if types conflict)
 * - Supports explicit layout(location) for WebGL2
 * - Maps InterStageType (WGSL-style) to appropriate GLSL types
 * - Returns both vertex (`out`) and fragment (`in`) declarations
 *
 * GLSL builtins available (not declared, use directly):
 * - gl_Position (vec4) - vertex output
 * - gl_FrontFacing (bool) - fragment input
 * - gl_SampleID (int) - fragment input
 * - gl_SampleMaskIn (int[]) - fragment input
 * @example
 * ```ts
 * const { vertex, fragment } = compileInterStageGlsl(bits);
 *
 * // vertex:
 * // layout(location = 0) out vec3 vNormal;
 * // layout(location = 1) out vec2 vUV;
 *
 * // fragment:
 * // layout(location = 0) in vec3 vNormal;
 * // layout(location = 1) in vec2 vUV;
 * ```
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

  // Collect user inter-stage variables from all bits, deduplicating (skip builtins)
  const interStage = new Map<string, InterStageType>();

  for (const bit of bits) {
    if (!bit.interStage) continue;

    for (const [name, type] of Object.entries(bit.interStage)) {
      // Skip builtins - they're implicit in GLSL (gl_Position, gl_FrontFacing, etc.)
      if (BUILTIN_NAMES.has(name)) continue;

      if (!interStage.has(name)) {
        interStage.set(name, type as InterStageType);
      } else if (interStage.get(name) !== type) {
        warnInterStageConflict(name, type, interStage.get(name)!);
      }
    }
  }

  // Generate vertex output declarations
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

  // Generate fragment input declarations
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
