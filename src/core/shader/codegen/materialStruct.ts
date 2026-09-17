import { warn } from 'pixi.js';

import type { ShaderBit, StructDefinition } from '../ShaderBit';
import { packStructFields } from './packStructFields';
import { bindingType, isStorageType, RESOURCE_TYPES } from './parseBindingType';

/**
 * Builds the canonical Material struct for a bit list
 *
 * Every bit's `bindings.material` fields are merged (first declaration wins; a redeclaration
 * with a different type warns and is ignored — matching the generic binding collectors) and
 * packed by `packStructFields`.
 *
 * This is the single definition of "a material's GPU layout". The compile pipeline canonicalises
 * `structs.Material` through it (see `materialStructPackPlugin`), and materials snapshot it at
 * construction — which is possible at all because every bit that declares `material` fields is
 * construction-pinned. `validateMaterialStruct` holds the two sides equal.
 *
 * Resource and storage types in the `material` group are skipped, mirroring the collectors: the
 * material group is never a bound group, so such declarations never reach the shader.
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
 * Serialises a struct definition stably, for equality checks between a material's
 * construction-time layout and the compiled shader's
 *
 * Field order is part of the contract (offsets follow it), so insertion order is preserved.
 * @param def - The struct definition to serialise
 * @returns A JSON string preserving field order
 * @internal
 */
export function materialStructSnapshot(def: StructDefinition): string {
  return JSON.stringify(def);
}
