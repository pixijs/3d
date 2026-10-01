import { warn } from 'pixi.js';

import { MATERIAL_STRIDE_BYTES } from '../../buffers/MaterialDataStoreBuffer';
import type { ShaderBit, StructDefinition } from '../ShaderBit';
import { MATERIAL_FIELD_SCALARS } from './materialTexelLayout';
import { packStructFields } from './packStructFields';
import { bindingType, isStorageType, RESOURCE_TYPES } from './parseBindingType';
import { createStructLayout, formatStructLayout } from './structLayout';

/**
 * Builds the `Material` struct for a bit list
 *
 * It merges every bit's `bindings.material` fields and packs them with `packStructFields`. The
 * first declaration of a name wins, and a later one with a different type warns and is ignored, as
 * the other binding collectors do.
 *
 * This is the one definition of a material's layout. The compiler takes the shader's struct from
 * it (see `materialStructPackPlugin`), and each material takes its own from it at construction.
 * The two can only match because the bits that declare `material` fields are fixed at
 * construction; `validateMaterialStruct` checks that they do.
 *
 * Texture, sampler and storage types in the `material` group are skipped: the group is never
 * bound, so they would never reach the shader.
 *
 * Every other field must be one of the `MATERIAL_FIELD_SCALARS` types, so it fits one texel of the
 * material store, and the packed struct must fit the store stride. Both throw here, naming the bit
 * for a bad field, because this runs at material construction as well as at compile.
 * @param bits - Shader bits whose `bindings.material` fields are merged
 * @returns The merged, packed struct definition
 * @internal
 */
export function mergeMaterialStruct(bits: readonly ShaderBit[]): StructDefinition {
  const fields: StructDefinition = {};

  for (const bit of bits) {
    const declared = bit.bindings?.material;
    if (!declared) continue;

    for (const [name, spec] of Object.entries(declared)) {
      const type = bindingType(spec);
      if (RESOURCE_TYPES.has(type) || isStorageType(type)) continue;

      if (!MATERIAL_FIELD_SCALARS[type]) {
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

  const packed = packStructFields(fields);
  const layout = createStructLayout(packed);

  if (layout.size > MATERIAL_STRIDE_BYTES) {
    throw new Error(
      `[mergeMaterialStruct] Material struct is ${layout.size} bytes, ` +
        `which exceeds the material store stride of ${MATERIAL_STRIDE_BYTES} bytes, ` +
        `so its data would spill into the next material's row. ` +
        `Trim or pack material fields:\n${formatStructLayout(layout)}`,
    );
  }

  return packed;
}

/**
 * Serialises a struct definition, to compare a material's construction-time layout with the
 * compiled shader's
 *
 * Field order sets the offsets, so the snapshot keeps it.
 * @param def - The struct definition to serialise
 * @returns A JSON string preserving field order
 * @internal
 */
export function materialStructSnapshot(def: StructDefinition): string {
  return JSON.stringify(def);
}
