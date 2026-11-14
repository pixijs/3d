import { collectTextureNames } from '../../../materials/utils/validateMaterialTextureSlots';
import { assertBitIdentity } from '../bitRegistry';
import { materialStructSnapshot, mergeMaterialStruct } from '../codegen/materialStruct';
import { resolveShaderBits } from '../resolveShaderBits';
import type { BindingGroup, ShaderBit, StructDefinition } from '../ShaderBit';

/**
 * `'direct'` draws one material, reading its row as a uniform; `'merged'` instances a run of
 * materials, each reading its row from the material store's texture
 * @internal
 */
export type MaterialShaderForm = 'direct' | 'merged';

/** Keyed as the bit's name is, so each name stands for one bit, as `assertBitIdentity` requires */
const materialBits = new Map<string, ShaderBit>();

/**
 * The bindings bit a material shader compiles with: texture `t` at binding `2t` and its sampler at
 * `2t + 1`, for exactly the textures the shader's bits declare, then, in the direct form, the
 * material row as `material: 'uniform<Material>'`
 *
 * The textures are read off the bit list, the way the pack plugin reads the struct, so nothing is
 * declared twice. The `material` binding is the material's row of the material store, which the
 * material binds under that name as a `BufferResource` at its place. `Material` is the struct the
 * bits already declare through their `material` fields, packed in the store's order, so WGSL reads
 * `material.<field>` in place. WebGL compiles no material in the direct form. Bits with no
 * material fields declare no `material` binding, and the material binds none.
 *
 * The merged form declares the textures and samplers only, whatever the struct holds: its
 * instances span materials, so the row comes from the store's texture by index, through
 * `materialTextureAccessPlugin` on WebGPU and `materialTextureAccessPluginGl` on WebGL, and no
 * uniform could carry it. A material's own bind group has the direct shape, so a 2-texture
 * material declares and binds five entries; its merged group binds the same four without the row.
 * @param bits - The shader's bits, before this bit joins them
 * @param form - Whether the shader draws one material or a merged run of them
 * @returns The bit for the texture count those bits declare, in the given form
 * @internal
 */
export function materialBindingsBit(bits: readonly ShaderBit[], form: MaterialShaderForm): ShaderBit {
  const count = collectTextureNames(bits).length;
  const hasRow = form === 'direct' && Object.keys(mergeMaterialStruct(bits)).length > 0;
  const key = `${count}|${form}|${hasRow}`;
  let bit = materialBits.get(key);
  if (bit) return bit;

  const batch: BindingGroup = Object.fromEntries(
    Array.from({ length: count }, (_, t) => t).flatMap((t) => [
      [`uMaterialTexture${t}`, 'texture_2d<f32>'] as const,
      [`uMaterialSampler${t}`, 'sampler'] as const,
    ]),
  );
  if (hasRow) batch.material = 'uniform<Material>';
  bit = {
    name: `materialBindings:${count}:${form}${hasRow ? ':material' : ''}`,
    bindings: { batch },
  };
  materialBits.set(key, bit);

  return bit;
}

/** The layout bits built so far, by the struct and texture names each declares */
const layoutBits = new Map<string, ShaderBit>();

/**
 * A short name for a layout that depends only on its content, so the same layout gets the same
 * bit name wherever it is built, as `assertBitIdentity` requires of a module evaluated twice
 * @param key - The layout's struct snapshot and texture names
 */
function layoutId(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193);

  return (hash >>> 0).toString(36);
}

/**
 * The bit that declares a material's whole layout and holds no code: every field of its struct,
 * in packed order, and every texture name, in slot order
 *
 * A shader that lists it ahead of the material's other bits declares exactly the material's
 * layout, whichever of those bits it goes on to list, since the first bit to declare a field or
 * a texture name wins. Materials with the same layout share one bit.
 *
 * The bit's name stands for the layout in a shader's cache key, so each new bit's claim to its
 * name is checked: two layouts whose names came out the same throw here.
 * @param struct - The material's packed struct
 * @param textureNames - The material's texture names, in slot order
 * @returns The bit for that layout
 * @internal
 */
export function materialLayoutBit(struct: StructDefinition, textureNames: readonly string[]): ShaderBit {
  const key = `${materialStructSnapshot(struct)}|${textureNames.join('|')}`;
  let bit = layoutBits.get(key);
  if (bit) return bit;

  bit = { name: `materialLayout:${layoutId(key)}`, bindings: { material: struct }, textures: [...textureNames] };
  assertBitIdentity(bit);
  layoutBits.set(key, bit);

  return bit;
}

/**
 * Whether a bit declares material fields or textures
 * @param bit - The bit to check
 */
function declaresMaterialData(bit: ShaderBit): boolean {
  return !!bit.bindings?.material || !!bit.textures?.length;
}

/**
 * The index of the first bit that reads the material, or -1 when none does
 *
 * A bit reads the material when it declares material fields or textures, or when a bit it
 * `requires` does, however far down the chain. So a bit with no material data of its own that
 * requires one with some still gets the material's layout, ahead of the bit the compiler adds for
 * it.
 * @param bits - The bits to search
 * @internal
 */
export function firstBitReadingMaterial(bits: readonly ShaderBit[]): number {
  for (let i = 0; i < bits.length; i++) {
    const bit = bits[i];

    if ((bit._readsMaterial ??= resolveShaderBits([bit]).some(declaresMaterialData))) return i;
  }

  return -1;
}
