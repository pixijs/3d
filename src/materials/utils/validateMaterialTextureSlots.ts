import { materialStructSnapshot, mergeMaterialStruct } from '../../core/shader/codegen/materialStruct';
import type { ShaderBit } from '../../core/shader/ShaderBit';
import type { BaseMaterial3D } from '../BaseMaterial3D';

/**
 * Assert that the final compiled bit list produces exactly the construction-time Material struct
 *
 * Holding the two equal is what makes a material's GPU layout knowable before it ever renders —
 * the `material.data` contract — and it can only hold while struct-contributing bits stay
 * construction-pinned.
 *
 * Throws on divergence, which catches a per-mesh or per-view bit (normal
 * mapping, skinning, tonemapping, fog, …) growing `bindings.material`
 * fields, or a custom `getPrimaryDescriptor` adding struct-bearing bits the
 * constructor never saw. Runs once per shader build, never per frame.
 * @param bits - Final compiled bit list
 * @param material - Material whose construction-time snapshot to check against
 * @internal
 */
export function validateMaterialStruct(bits: readonly ShaderBit[], material: BaseMaterial3D): void {
  const compiled = materialStructSnapshot(mergeMaterialStruct(bits));

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
 * Collect the texture names declared across `bits`
 *
 * Names come back in the sequential order texturesPluginGpu/Gl assign the compiled shader's
 * sample indices.
 * @param bits - Bit list to collect from
 * @returns Declared texture names in sample-index order
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
 * Assert that a material's derived texture slots line up with the final compiled bit list
 *
 * The shader's `sampleX` helper for the i-th declared texture name reads packed nibble `i`, and
 * the batcher packs nibble `i` from `material._textures[i]` — this check is the bridge between
 * the two, run once per shader build (never per frame).
 *
 * Throws on divergence, which catches:
 *  (a) a bit outside the material's slot derivation (global / pass / future
 *      infrastructure bits) growing a `textures` declaration, and
 *  (b) a custom `getPrimaryDescriptor` override whose bit list no longer
 *      matches the slots the material derived at construction.
 * @param bits - Final compiled bit list
 * @param material - Material whose derived slot layout to check against
 * @internal
 */
export function validateMaterialTextureSlots(bits: readonly ShaderBit[], material: BaseMaterial3D): void {
  const names = collectTextureNames(bits);

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
