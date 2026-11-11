import { warn } from 'pixi.js';

import {
  bindingFields,
  bindingType,
  capitalize,
  isStorageType,
  isUniformBufferType,
  parseUniformBufferType,
} from '../../shader/codegen/parseBindingType';
import type { ShaderBit, StructDefinition } from '../../shader/ShaderBit';
import { resolveBindGroups } from '../../shader/ShaderBitTemplate';
import type { ResolvedBindGroup, ShaderBitTemplate } from '../../shader/ShaderBitTemplate';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';
import { WGSL_TO_GLSL_BINDING_TYPE } from './wgslToGlsl';

interface ArrayInfo {
  baseType: string;
  size: string;
}

function parseArrayType(wgslType: string): ArrayInfo | null {
  const match = wgslType.match(/^array<(.+),\s*(\d+)>$/);
  if (!match) return null;
  return { baseType: match[1], size: match[2] };
}

/** `null` for a type GLSL declares nothing for, such as a standalone sampler */
function toGlslType(wgslType: string): string | null | { glslType: string; arraySize: string } {
  const arrayInfo = parseArrayType(wgslType);
  if (arrayInfo) {
    const baseGlsl = WGSL_TO_GLSL_BINDING_TYPE[arrayInfo.baseType] ?? arrayInfo.baseType;
    if (!baseGlsl) return null;
    return { glslType: baseGlsl, arraySize: arrayInfo.size };
  }

  const mapped = WGSL_TO_GLSL_BINDING_TYPE[wgslType];
  if (mapped !== undefined) return mapped || null;
  return wgslType;
}

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
 * The block takes the binding's name, which pixi binds by, and GLSL rejects an instance named like its block, so
 * the instance is `u` plus the capitalised name
 * @internal
 */
export function uniformBlockInstanceName(bindingName: string): string {
  return `u${capitalize(bindingName)}`;
}

/**
 * A `mat2x2<f32>` block member is split into two `vec2` columns, since `std140` pads a `mat2` to 32 bytes where
 * WGSL packs 16
 * @internal
 */
export function mat2ColumnMember(name: string, column: 0 | 1): string {
  return `${name}_${column}`;
}

function fitsBufferBlock(wgslType: string): boolean {
  const array = parseArrayType(wgslType);
  const base = array ? array.baseType : wgslType;

  if (/^mat[234]x2</.test(base)) return !array && base === 'mat2x2<f32>';

  return !array || base.startsWith('vec4') || base.startsWith('mat');
}

interface UniformEntry {
  glslType: string;
  arraySize?: string;
}

interface GroupData {
  uniformGroups: Record<string, Record<string, UniformEntry>>;
  resources: Record<string, string>;
  uniformBuffers: Record<string, string>;
}

function toGlslTypeSimple(wgslType: string): string {
  const mapped = WGSL_TO_GLSL_BINDING_TYPE[wgslType];
  if (mapped !== undefined) return mapped || wgslType;
  return wgslType;
}

function warnBindingConflict(name: string, newType: string, existingType: string): void {
  warn(
    `[collectBindingsGlsl] Binding "${name}" redefined with different type: ` +
      `"${existingType}" → "${newType}". Keeping original.`,
  );
}

/** @internal */
export interface CollectedBindingsGlsl {
  groups: readonly ResolvedBindGroup[];
  bindGroups: Record<string, GroupData>;
  structs: Record<string, StructDefinition>;
}

function collectBindingsGlsl(bits: ShaderBit[], template: ShaderBitTemplate): CollectedBindingsGlsl {
  const groups = resolveBindGroups(template);

  const bindGroups: Record<string, GroupData> = Object.create(null);
  for (const { name } of groups) {
    bindGroups[name] = {
      uniformGroups: Object.create(null),
      resources: Object.create(null),
      uniformBuffers: Object.create(null),
    };
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
      const structName = capitalize(groupName);
      const isBound = groupName in bindGroups;

      for (const { name, spec, uniformGroup: fieldGroup } of bindingFields(bindings, groupName)) {
        const wgslType = bindingType(spec);
        if (isStorageType(wgslType)) continue;

        if (isUniformBufferType(wgslType)) {
          if (!isBound) continue;
          const bufferStruct = parseUniformBufferType(wgslType);
          if (!bufferStruct) {
            warn(
              `[collectBindingsGlsl] Bit "${bit.name}" binding "${name}" has invalid uniform buffer type: ` +
                `"${wgslType}". Expected format: uniform<StructName>`,
            );
            continue;
          }
          const buffers = bindGroups[groupName].uniformBuffers;
          if (!(name in buffers)) {
            buffers[name] = bufferStruct;
            structs[bufferStruct] ??= {};
          } else if (buffers[name] !== bufferStruct) {
            warnBindingConflict(name, bufferStruct, buffers[name]);
          }
          continue;
        }

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
          const uniformGroup = isBound ? fieldGroup : groupName;
          if (isBound) {
            const unis: Record<string, UniformEntry> = (bindGroups[groupName].uniformGroups[uniformGroup] ??=
              Object.create(null));
            if (!(name in unis)) unis[name] = { glslType, arraySize };
          }
          if (uniformGroup !== groupName) continue;

          if (!(structName in structs)) structs[structName] = {};
          const structDef = structs[structName];
          if (structDef[name] && structDef[name] !== wgslType) {
            warnBindingConflict(name, wgslType, structDef[name]);
          } else {
            structDef[name] = wgslType as StructDefinition[string];
          }
        }
      }
    }
  }

  return { groups, bindGroups, structs };
}

function formatBlockMember(blockName: string, name: string, wgslType: string): string[] {
  if (!fitsBufferBlock(wgslType)) {
    throw new Error(
      `[emitBindingsGlsl] Field "${name}" of uniform block "${blockName}" is "${wgslType}", ` +
        'which std140 lays out differently from WGSL. A buffer-backed block takes scalars, vectors, ' +
        'mat2x2<f32>, matrices of vec3 or vec4 columns, and arrays of 16-byte elements.',
    );
  }
  if (wgslType === 'mat2x2<f32>') {
    return [`  vec2 ${mat2ColumnMember(name, 0)};`, `  vec2 ${mat2ColumnMember(name, 1)};`];
  }

  const glsl = toGlslType(wgslType)!;
  const entry: UniformEntry = typeof glsl === 'object' ? glsl : { glslType: glsl };

  return [`  ${formatUniform(name, entry)};`];
}

function formatUniform(name: string, entry: UniformEntry): string {
  if (entry.arraySize) {
    return `${entry.glslType} ${name}[${entry.arraySize}]`;
  }
  return `${entry.glslType} ${name}`;
}

function emitBindingsGlsl(collected: CollectedBindingsGlsl, structs: Record<string, StructDefinition>): string {
  const { groups, bindGroups } = collected;

  for (const groupName in bindGroups) {
    const { uniformBuffers } = bindGroups[groupName];
    for (const name in uniformBuffers) {
      const structName = uniformBuffers[name];
      if (Object.keys(structs[structName] ?? {}).length === 0) {
        throw new Error(
          `[emitBindingsGlsl] Binding "${name}" is "uniform<${structName}>", but no bit declares fields for a ` +
            `"${structName}" struct.`,
        );
      }
    }
  }

  const out: string[] = [];

  for (const structName in structs) {
    const groupName = structName.charAt(0).toLowerCase() + structName.slice(1);
    if (bindGroups[groupName]?.uniformGroups[groupName]) continue;

    const structDef = structs[structName];
    out.push(`struct ${structName} {`);
    for (const [fieldName, fieldType] of Object.entries(structDef)) {
      out.push(`  ${toGlslTypeSimple(fieldType)} ${fieldName};`);
    }
    out.push('};');
  }

  for (const { name: groupName, ubo } of groups) {
    const group = bindGroups[groupName];
    const own = group.uniformGroups[groupName];

    if (own && ubo) {
      out.push(`layout(std140) uniform ${groupName} {`);
      for (const name in own) out.push(`  ${formatUniform(name, own[name])};`);
      out.push('};');
    } else if (own) {
      for (const name in own) out.push(`uniform ${formatUniform(name, own[name])};`);
    }

    for (const name in group.resources) {
      out.push(`uniform ${group.resources[name]} ${name};`);
    }

    for (const name in group.uniformBuffers) {
      const structDef = structs[group.uniformBuffers[name]];
      out.push(`layout(std140) uniform ${name} {`);
      for (const field in structDef) out.push(...formatBlockMember(name, field, structDef[field]));
      out.push(`} ${uniformBlockInstanceName(name)};`);
    }

    for (const uniformGroup in group.uniformGroups) {
      if (uniformGroup === groupName) continue;
      const fields = group.uniformGroups[uniformGroup];
      for (const name in fields) out.push(`uniform ${formatUniform(name, fields[name])};`);
    }
  }

  return out.join('\n');
}

/**
 * Emits in `injectCode`, not `collectData`, so a `uniform<Material>` block takes the order `materialStructPackPlugin`
 * packs the struct into during `preCompile`
 * @internal
 */
export const glslBindingsPlugin: ShaderCompilerPlugin = {
  collectData(context) {
    const glsl = (context.data.glsl ??= {});
    if (glsl.bindingGroups === undefined) {
      glsl.bindingGroups = collectBindingsGlsl(context.bits, context.template);
      context.data.structs = glsl.bindingGroups.structs;
    }
  },
  injectCode(context) {
    const glsl = context.data.glsl!;
    glsl.bindings ??= emitBindingsGlsl(glsl.bindingGroups!, context.data.structs!);
    return { header: glsl.bindings };
  },
};
