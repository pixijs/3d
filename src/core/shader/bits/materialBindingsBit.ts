import { collectTextureNames } from '../../../materials/utils/validateMaterialTextureSlots';
import { mergeMaterialStruct } from '../codegen/materialStruct';
import type { BindingGroup, ShaderBit } from '../ShaderBit';

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
