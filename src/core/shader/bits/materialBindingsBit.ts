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
 * Texture `t` at binding `2t` and its sampler at `2t + 1`, then the direct form's `material` row:
 * the shape `BaseMaterial3D` binds. `textureGetters` in `texturesPluginGpu.ts` numbers textures the same way
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

const layoutBits = new Map<string, ShaderBit>();

/** Hashes the content, so a module evaluated twice names a layout the same (`assertBitIdentity`) */
function layoutId(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193);

  return (hash >>> 0).toString(36);
}

/**
 * A bit with no code that declares a material's whole struct and texture list; listed first, it
 * fixes the shader's layout, and its name stands for that layout in shader cache keys
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

function declaresMaterialData(bit: ShaderBit): boolean {
  return !!bit.bindings?.material || !!bit.textures?.length;
}

/**
 * The index of the first bit that reads the material, through `requires` too, or -1
 * @internal
 */
export function firstBitReadingMaterial(bits: readonly ShaderBit[]): number {
  for (let i = 0; i < bits.length; i++) {
    const bit = bits[i];

    if ((bit._readsMaterial ??= resolveShaderBits([bit]).some(declaresMaterialData))) return i;
  }

  return -1;
}
