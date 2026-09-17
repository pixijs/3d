import { warn } from 'pixi.js';

import { bindingType, isStorageType } from '../../shader/codegen/parseBindingType';
import type { ShaderBit, StructDefinition } from '../../shader/ShaderBit';
import type { ShaderBitTemplate } from '../../shader/ShaderBitTemplate';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/** Maps WGSL types to GLSL types */
const WGSL_TO_GLSL: Record<string, string> = {
  // Scalars
  f32: 'float',
  i32: 'int',
  u32: 'uint',
  bool: 'bool',

  // Vectors
  'vec2<f32>': 'vec2',
  'vec3<f32>': 'vec3',
  'vec4<f32>': 'vec4',
  'vec2<i32>': 'ivec2',
  'vec3<i32>': 'ivec3',
  'vec4<i32>': 'ivec4',
  'vec2<u32>': 'uvec2',
  'vec3<u32>': 'uvec3',
  'vec4<u32>': 'uvec4',

  // Matrices
  'mat2x2<f32>': 'mat2',
  'mat3x3<f32>': 'mat3',
  'mat4x4<f32>': 'mat4',
  'mat2x3<f32>': 'mat2x3',
  'mat2x4<f32>': 'mat2x4',
  'mat3x2<f32>': 'mat3x2',
  'mat3x4<f32>': 'mat3x4',
  'mat4x2<f32>': 'mat4x2',
  'mat4x3<f32>': 'mat4x3',

  // Textures → samplers in GLSL
  'texture_2d<f32>': 'sampler2D',
  'texture_2d_array<f32>': 'sampler2DArray',
  'texture_3d<f32>': 'sampler3D',
  'texture_cube<f32>': 'samplerCube',
  texture_depth_2d: 'sampler2DShadow',
  texture_depth_2d_array: 'sampler2DArrayShadow',
  texture_depth_cube: 'samplerCubeShadow',
  texture_depth_cube_array: 'samplerCubeArrayShadow',

  // Samplers (combined with textures in GLSL, so we skip standalone samplers)
  sampler: '',
  sampler_comparison: '',
};

/** Parsed array info for WGSL array types */
interface ArrayInfo {
  baseType: string;
  size: string;
}

/**
 * Parses WGSL array syntax: `array<type, size>` → { baseType, size }
 *
 * Returns null if not an array type.
 * @param wgslType - The WGSL type string to parse
 */
function parseArrayType(wgslType: string): ArrayInfo | null {
  const match = wgslType.match(/^array<(.+),\s*(\d+)>$/);
  if (!match) return null;
  return { baseType: match[1], size: match[2] };
}

/**
 * Converts a WGSL type to a GLSL type
 *
 * Returns null if the type should be skipped (e.g., standalone sampler).
 * For array types, returns { glslType, arraySize } to allow proper declaration.
 * @param wgslType - The WGSL binding type to convert
 */
function toGlslType(wgslType: string): string | null | { glslType: string; arraySize: string } {
  // Check for array type first
  const arrayInfo = parseArrayType(wgslType);
  if (arrayInfo) {
    const baseGlsl = WGSL_TO_GLSL[arrayInfo.baseType] ?? arrayInfo.baseType;
    if (!baseGlsl) return null;
    return { glslType: baseGlsl, arraySize: arrayInfo.size };
  }

  const mapped = WGSL_TO_GLSL[wgslType];
  if (mapped !== undefined) return mapped || null; // empty string = skip
  return wgslType; // pass through unknown types
}

/** GLSL resource types that can't go in UBOs (textures/samplers) */
const RESOURCE_TYPES = new Set([
  'sampler2D',
  'sampler2DArray',
  'sampler3D',
  'samplerCube',
  'sampler2DShadow',
  'sampler2DArrayShadow',
  'samplerCubeShadow',
  'samplerCubeArrayShadow',
]);

/**
 * Options for `compileBindingsGlsl`
 * @internal
 */
interface CompileBindingsGlslOptions {
  /**
   * Groups to compile as UBOs (WebGL2 uniform buffer objects)
   * Groups not in this set are compiled as flat uniforms.
   * @example ["global", "material"] // these groups use UBOs
   */
  uboGroups?: Set<string> | string[];
}

/** Uniform entry with optional array size */
interface UniformEntry {
  glslType: string;
  arraySize?: string; // undefined for non-arrays
}

interface GroupData {
  uniforms: Record<string, UniformEntry>;
  resources: Record<string, string>;
  bindAsUniform: boolean;
}

/**
 * Converts a WGSL type to a simple GLSL type string (for struct fields)
 *
 * Returns the GLSL type or the original if no mapping exists.
 * @param wgslType - The WGSL struct field type to convert
 */
function toGlslTypeSimple(wgslType: string): string {
  const mapped = WGSL_TO_GLSL[wgslType];
  if (mapped !== undefined) return mapped || wgslType;
  return wgslType;
}

function warnBindingConflict(name: string, newType: string, existingType: string): void {
  warn(
    `[compileBindingsGlsl] Binding "${name}" redefined with different type: ` +
      `"${existingType}" → "${newType}". Keeping original.`,
  );
}

/**
 * Result of `compileBindingsGlsl`: the emitted declarations plus the resolved
 * struct definitions
 * @internal
 */
interface CompileBindingsGlslResult {
  /** GLSL source with struct, uniform, and UBO declarations */
  source: string;
  /** Resolved group struct definitions (e.g. `{ Material: { baseColor: 'vec4<f32>', ... } }`) */
  structs: Record<string, StructDefinition>;
}

/**
 * Compiles shader bindings from bits into GLSL uniform declarations
 *
 * - Supports both flat uniforms and UBOs (WebGL2)
 * - Textures become samplers (always flat, can't be in UBOs)
 * - Standalone samplers are skipped (combined with textures in GLSL)
 * - Duplicates are automatically deduplicated (warns if types conflict)
 * @example
 * ```ts
 * // Flat uniforms (WebGL1 compatible)
 * const glsl = compileBindingsGlsl(bits, template);
 * // uniform vec4 uColor;
 *
 * // With UBOs (WebGL2)
 * const glsl = compileBindingsGlsl(bits, template, {
 *   uboGroups: ["global", "material"]
 * });
 * // layout(std140) uniform materialUniforms { vec4 uColor; };
 * ```
 * @param bits - Array of shader bits containing binding definitions
 * @param template - Template defining bind group names
 * @param options - Optional settings (e.g., which groups use UBOs)
 * @returns GLSL declaration source plus resolved struct definitions
 */
function compileBindingsGlsl(
  bits: ShaderBit[],
  template: ShaderBitTemplate,
  options: CompileBindingsGlslOptions = {},
): CompileBindingsGlslResult {
  const uboGroups = new Set(options.uboGroups ?? []);
  const bindGroupNames = new Set(template.bindGroups);

  // Per-bind-group resource data (textures/samplers only — uniforms go into structs).
  const bindGroups: Record<string, GroupData> = Object.create(null);
  for (const groupName of template.bindGroups) {
    bindGroups[groupName] = { uniforms: Object.create(null), resources: Object.create(null), bindAsUniform: false };
  }

  // All struct definitions: explicit (bit.structs) + generated from groups.
  const structs: Record<string, StructDefinition> = Object.create(null);

  // Collect explicit structs from bits
  for (const bit of bits) {
    if (!bit.structs) continue;
    for (const [structName, structDef] of Object.entries(bit.structs)) {
      if (!(structName in structs)) {
        structs[structName] = structDef;
      }
    }
  }

  // Collect bindings from all bits — every group produces a struct from
  // its uniform-type fields; bind groups also collect resources.
  for (const bit of bits) {
    if (!bit.bindings) continue;

    for (const [groupName, bindings] of Object.entries(bit.bindings)) {
      if (!bindings) continue;
      const structName = groupName.charAt(0).toUpperCase() + groupName.slice(1);
      const isBound = bindGroupNames.has(groupName);

      for (const [name, spec] of Object.entries(bindings)) {
        const wgslType = bindingType(spec);
        if (isStorageType(wgslType)) continue;

        const glslResult = toGlslType(wgslType);
        if (!glslResult) continue;

        const isArrayType = typeof glslResult === 'object';
        const glslType = isArrayType ? glslResult.glslType : glslResult;
        const arraySize = isArrayType ? glslResult.arraySize : undefined;

        if (RESOURCE_TYPES.has(glslType)) {
          if (isBound) {
            const res = bindGroups[groupName].resources;
            if (!(name in res)) {
              res[name] = glslType;
            } else if (res[name] !== glslType) {
              warnBindingConflict(name, glslType, res[name]);
            }
          }
        } else {
          // Bind-group uniforms need array info for UBO/flat declarations.
          if (isBound) {
            const unis = bindGroups[groupName].uniforms;
            if (!(name in unis)) {
              unis[name] = { glslType, arraySize };
            }
            bindGroups[groupName].bindAsUniform = true;
          }

          // All uniform-type fields (bound or not) contribute to the struct.
          if (!(structName in structs)) structs[structName] = {};
          const structDef = structs[structName];
          if (structDef[name] && structDef[name] !== wgslType) {
            warnBindingConflict(name, wgslType, structDef[name] as string);
          } else {
            structDef[name] = wgslType as StructDefinition[string];
          }
        }
      }
    }
  }

  // --- Generate output ---
  const out: string[] = [];

  // Emit struct definitions (skip bind-group structs — those become UBO/uniform blocks)
  for (const structName in structs) {
    // Only skip bind group structs if they are actually used as uniforms
    const groupNameLower = structName.charAt(0).toLowerCase() + structName.slice(1);
    if (bindGroupNames.has(groupNameLower) && bindGroups[groupNameLower]?.bindAsUniform) continue;

    const structDef = structs[structName];
    out.push(`struct ${structName} {`);
    for (const [fieldName, fieldType] of Object.entries(structDef)) {
      out.push(`  ${toGlslTypeSimple(fieldType)} ${fieldName};`);
    }
    out.push('};');
  }

  /**
   * Formats a uniform declaration with optional array size
   * @param name - The uniform's name
   * @param entry - The uniform's GLSL type and optional array size
   */
  const formatUniform = (name: string, entry: UniformEntry): string => {
    if (entry.arraySize) {
      return `${entry.glslType} ${name}[${entry.arraySize}]`;
    }
    return `${entry.glslType} ${name}`;
  };

  for (const groupName of template.bindGroups) {
    const group = bindGroups[groupName];
    const uniformKeys = Object.keys(group.uniforms);

    if (uniformKeys.length > 0) {
      if (uboGroups.has(groupName)) {
        out.push(`layout(std140) uniform ${groupName} {`);
        for (const name of uniformKeys) {
          out.push(`  ${formatUniform(name, group.uniforms[name])};`);
        }
        out.push('};');
      } else {
        for (const name of uniformKeys) {
          out.push(`uniform ${formatUniform(name, group.uniforms[name])};`);
        }
      }
    }

    for (const name in group.resources) {
      out.push(`uniform ${group.resources[name]} ${name};`);
    }
  }

  return { source: out.join('\n'), structs };
}

/**
 * GLSL compiler plugin that compiles binding declarations once, shares the
 * resolved structs via `context.data`, and injects the source into the
 * `{{header}}` slot
 * @internal
 */
export const glslBindingsPlugin: ShaderCompilerPlugin = {
  collectData(context) {
    if (!context.data.bindings) {
      context.data.bindings = compileBindingsGlsl(context.bits, context.template, {
        uboGroups: context.glslOptions?.uboGroups,
      }) as any;
      context.data.structs = context.data.bindings!.structs as any;
    }
  },
  injectCode(context) {
    return { header: (context.data.bindings as any).source };
  },
};
