import { materialStructSnapshot, mergeMaterialStruct } from '../../core/shader/codegen/materialStruct';
import type { ShaderBit } from '../../core/shader/ShaderBit';
import type { BaseMaterial3D } from '../BaseMaterial3D';

/**
 * The material-facing layout a compiled bit list declares
 *
 * What `validateMaterialStruct` and `validateMaterialTextureSlots` hold a material against. The
 * material systems build it once per compiled shader and keep it beside the shader, so validating a
 * material that hits the shader cache is a string compare and a short loop.
 * @internal
 */
export interface MaterialLayout {
  /** Canonical snapshot of the merged `bindings.material` struct */
  structSnapshot: string;
  /** Declared texture names, in the order the compiled shader assigns sample indices */
  textureNames: string[];
}

/**
 * Build the {@link MaterialLayout} a bit list declares
 * @param bits - Final compiled bit list
 * @returns The struct snapshot and texture names the bits declare
 * @internal
 */
export function getMaterialLayout(bits: readonly ShaderBit[]): MaterialLayout {
  return {
    structSnapshot: materialStructSnapshot(mergeMaterialStruct(bits)),
    textureNames: collectTextureNames(bits),
  };
}

/**
 * Assert that a compiled layout's Material struct matches the material's construction-time struct
 *
 * Keeping the two equal is what lets `material.data` have the GPU layout before the material ever
 * renders, and it holds only while the bits that add struct fields are fixed at construction.
 *
 * Throws on a mismatch, which catches a per-mesh or per-view bit (normal mapping, skinning, tone
 * mapping, fog and so on) adding `bindings.material` fields, or a custom `getPrimaryDescriptor`
 * adding struct fields the constructor never saw. Runs for every material the systems make
 * resident, cache hits included.
 * @param layout - Layout of the final compiled bit list
 * @param material - Material whose construction-time snapshot to check against
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
 * Assert that a material's derived texture slots line up with a compiled layout's texture names
 *
 * The shader's `sampleX` helper for the i-th declared texture name reads packed nibble `i`, and
 * the batcher packs nibble `i` from `material._textures[i]`, so the two orders must agree. Runs for
 * every material the systems make resident, cache hits included.
 *
 * Throws on divergence, which catches:
 *  (a) a bit outside the material's slot derivation (global / pass / future
 *      infrastructure bits) growing a `textures` declaration, and
 *  (b) a custom `getPrimaryDescriptor` override whose bit list no longer
 *      matches the slots the material derived at construction.
 * @param layout - Layout of the final compiled bit list
 * @param material - Material whose derived slot layout to check against
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
