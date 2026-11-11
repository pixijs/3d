import { warn } from 'pixi.js';

import type { ShaderBit, StructDefinition } from '../ShaderBit';
import { packStructFields } from './packStructFields';
import { bindingFields, bindingType, isStorageType, isUniformBufferType, RESOURCE_TYPES } from './parseBindingType';

/** Each fits one texel; integers are scalars only, since the material data class writes vectors as floats */
const MATERIAL_FIELD_TYPES = new Set(['f32', 'vec2<f32>', 'vec3<f32>', 'vec4<f32>', 'mat2x2<f32>', 'u32', 'i32']);

/**
 * The one source of a material's layout: the shader (`materialStructPackPlugin`) and the material
 * at construction both take it from here, and `validateMaterialStruct` checks they match
 * @internal
 */
export function mergeMaterialStruct(bits: readonly ShaderBit[]): StructDefinition {
  const fields: StructDefinition = {};

  for (const bit of bits) {
    const declared = bit.bindings?.material;
    if (!declared) continue;

    for (const { name, spec } of bindingFields(declared, 'material')) {
      const type = bindingType(spec);
      if (RESOURCE_TYPES.has(type) || isStorageType(type) || isUniformBufferType(type)) continue;

      if (!MATERIAL_FIELD_TYPES.has(type)) {
        throw new Error(
          `[mergeMaterialStruct] Material field "${name}" in bit "${bit.name}" is "${type}". ` +
            `Material fields must be f32, u32, i32, a vec2, vec3 or vec4 of f32, or mat2x2<f32>.`,
        );
      }

      const existing = fields[name];
      if (existing === undefined) {
        fields[name] = type as StructDefinition[string];
      } else if (existing !== type) {
        warn(
          `[mergeMaterialStruct] Material field "${name}" redefined by bit "${bit.name}" with a different ` +
            `type: "${existing}" → "${type}". Keeping original.`,
        );
      }
    }
  }

  return packStructFields(fields);
}

/**
 * Keeps field order, which sets the offsets
 * @internal
 */
export function materialStructSnapshot(def: StructDefinition): string {
  return JSON.stringify(def);
}
