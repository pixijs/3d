import { warn } from 'pixi.js';

import { bindingType, isStorageType } from '../../shader/codegen/parseBindingType';
import type { ShaderBit, StructDefinition } from '../../shader/ShaderBit';
import type { ShaderBitTemplate } from '../../shader/ShaderBitTemplate';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/**
 * The GLSL type each WGSL binding type declares as
 *
 * Textures become `sampler*` uniforms. GLSL combines a texture with its sampling state, so a
 * standalone WGSL sampler maps to `''` and gets no declaration. Every sampler type here needs a
 * line in `GLSL_PRECISION_PRELUDE` in `glslPrecisionPlugin`; `samplerCubeArrayShadow` has none,
 * as GLSL ES 3.00 has no such type.
 */
const WGSL_TO_GLSL: Record<string, string> = {
  f32: 'float',
  i32: 'int',
  u32: 'uint',
  bool: 'bool',

  'vec2<f32>': 'vec2',
  'vec3<f32>': 'vec3',
  'vec4<f32>': 'vec4',
  'vec2<i32>': 'ivec2',
  'vec3<i32>': 'ivec3',
  'vec4<i32>': 'ivec4',
  'vec2<u32>': 'uvec2',
  'vec3<u32>': 'uvec3',
  'vec4<u32>': 'uvec4',

  'mat2x2<f32>': 'mat2',
  'mat3x3<f32>': 'mat3',
  'mat4x4<f32>': 'mat4',
  'mat2x3<f32>': 'mat2x3',
  'mat2x4<f32>': 'mat2x4',
  'mat3x2<f32>': 'mat3x2',
  'mat3x4<f32>': 'mat3x4',
  'mat4x2<f32>': 'mat4x2',
  'mat4x3<f32>': 'mat4x3',

  'texture_2d<f32>': 'sampler2D',
  'texture_2d<u32>': 'usampler2D',
  'texture_2d<i32>': 'isampler2D',
  'texture_2d_array<f32>': 'sampler2DArray',
  'texture_3d<f32>': 'sampler3D',
  'texture_cube<f32>': 'samplerCube',
  texture_depth_2d: 'sampler2DShadow',
  texture_depth_2d_array: 'sampler2DArrayShadow',
  texture_depth_cube: 'samplerCubeShadow',
  texture_depth_cube_array: 'samplerCubeArrayShadow',

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
 * Returns null if the type should be skipped (e.g., standalone sampler), and passes a type the
 * map doesn't know through unchanged. For array types, returns { glslType, arraySize } to allow
 * proper declaration.
 * @param wgslType - The WGSL binding type to convert
 */
function toGlslType(wgslType: string): string | null | { glslType: string; arraySize: string } {
  const arrayInfo = parseArrayType(wgslType);
  if (arrayInfo) {
    const baseGlsl = WGSL_TO_GLSL[arrayInfo.baseType] ?? arrayInfo.baseType;
    if (!baseGlsl) return null;
    return { glslType: baseGlsl, arraySize: arrayInfo.size };
  }

  const mapped = WGSL_TO_GLSL[wgslType];
  if (mapped !== undefined) return mapped || null;
  return wgslType;
}

/** GLSL sampler types, always declared as plain uniforms because a uniform block can't hold one */
const RESOURCE_TYPES = new Set([
  'sampler2D',
  'usampler2D',
  'isampler2D',
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
  /** Groups to declare as `std140` uniform blocks; any other group's fields become plain uniforms */
  uboGroups?: Set<string> | string[];
}

/** Uniform entry with optional array size */
interface UniformEntry {
  glslType: string;
  arraySize?: string;
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
 * For each group the template binds, its uniform fields become plain uniforms, or a
 * `layout(std140) uniform <group> { ... };` block when `uboGroups` names it, and its textures become
 * sampler uniforms. A group the template doesn't bind, such as `material`, becomes a struct named
 * after it (`Material`) for the shader to fill, as do the bits' own `structs`. Storage-buffer
 * bindings are skipped: they're WebGPU-only, and the GL bits declare data-texture twins instead.
 * A name declared twice with different types warns and keeps the first.
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

  const bindGroups: Record<string, GroupData> = Object.create(null);
  for (const groupName of template.bindGroups) {
    bindGroups[groupName] = { uniforms: Object.create(null), resources: Object.create(null), bindAsUniform: false };
  }

  const structs: Record<string, StructDefinition> = Object.create(null);

  for (const bit of bits) {
    if (!bit.structs) continue;
    for (const [structName, structDef] of Object.entries(bit.structs)) {
      if (!(structName in structs)) {
        structs[structName] = structDef;
      }
    }
  }

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
          if (isBound) {
            const unis = bindGroups[groupName].uniforms;
            if (!(name in unis)) {
              unis[name] = { glslType, arraySize };
            }
            bindGroups[groupName].bindAsUniform = true;
          }

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

  const out: string[] = [];

  for (const structName in structs) {
    const groupNameLower = structName.charAt(0).toLowerCase() + structName.slice(1);
    if (bindGroupNames.has(groupNameLower) && bindGroups[groupNameLower]?.bindAsUniform) continue;

    const structDef = structs[structName];
    out.push(`struct ${structName} {`);
    for (const [fieldName, fieldType] of Object.entries(structDef)) {
      out.push(`  ${toGlslTypeSimple(fieldType)} ${fieldName};`);
    }
    out.push('};');
  }

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
