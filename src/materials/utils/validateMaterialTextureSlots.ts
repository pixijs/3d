import { materialStructSnapshot, mergeMaterialStruct } from '../../core/shader/codegen/materialStruct';
import type { ShaderBit } from '../../core/shader/ShaderBit';
import type { BaseMaterial3D } from '../BaseMaterial3D';

/**
 * Built once per compiled shader and kept beside it, so validating a material on a cache hit stays cheap
 * @internal
 */
export interface MaterialLayout {
  structSnapshot: string;
  textureNames: string[];
}

/**
 * Builds the {@link MaterialLayout} a bit list declares
 * @internal
 */
export function getMaterialLayout(bits: readonly ShaderBit[]): MaterialLayout {
  return {
    structSnapshot: materialStructSnapshot(mergeMaterialStruct(bits)),
    textureNames: collectTextureNames(bits),
  };
}

/**
 * Throws unless the compiled struct matches the one `material.data` was laid out in at construction
 * @internal
 */
export function validateMaterialStruct(layout: MaterialLayout, material: BaseMaterial3D): void {
  const compiled = layout.structSnapshot;

  if (compiled !== material._materialStructSnapshot) {
    throw new Error(
      `[validateMaterialStruct] Compiled Material struct does not match the material's construction-time ` +
        `layout.\n  compiled:     ${compiled}\n  construction: ${material._materialStructSnapshot}\n` +
        `Material-group struct fields may only come from construction-pinned bits — a per-mesh/per-view ` +
        `bit is declaring \`bindings.material\` fields, or a custom getPrimaryDescriptor diverges from ` +
        `its constructor.`,
    );
  }
}

/**
 * Texture names across `bits`, in the order the textures plugins number the shader's samplers
 * @internal
 */
export function collectTextureNames(bits: readonly ShaderBit[]): string[] {
  const names: string[] = [];

  for (const bit of bits) {
    if (!bit.textures) continue;
    for (const name of bit.textures) names.push(name);
  }

  return names;
}

/**
 * Throws unless the shader's texture order matches the material's slots, which its bind groups bind
 * by position
 * @internal
 */
export function validateMaterialTextureSlots(layout: MaterialLayout, material: BaseMaterial3D): void {
  const names = layout.textureNames;

  for (let i = 0; i < names.length; i++) {
    if (material._slotByName[names[i]] !== i) {
      throw new Error(
        `[validateMaterialTextureSlots] Shader texture slots do not match the material's derived layout. ` +
          `Shader order: [${names.join(', ')}]; material slots: ${JSON.stringify(material._slotByName)}. ` +
          `Every texture-bearing bit must be part of the material's texture derivation.`,
      );
    }
  }

  if (names.length !== material._textures.length) {
    throw new Error(
      `[validateMaterialTextureSlots] Material allocates ${material._textures.length} texture slot(s) but the ` +
        `shader declares ${names.length} ([${names.join(', ')}]). Slots and bit declarations must derive together.`,
    );
  }
}
