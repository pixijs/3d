import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/**
 * The GLSL that reads one texture's 4-bit slot out of the packed `vTextureSlots`
 * @param shift - The slot's bit offset, four per texture in declaration order
 */
const slotOf = (shift: number) => `(vTextureSlots >> ${shift}u) & 15u`;

/**
 * The GLSL `sampleBatchSlotGrad`, which samples the batch texture unit a slot names
 *
 * Slots 0 to 9 are the batch units. `Mesh3DBatcherGl` gives the three textures it never binds slot
 * 13 + their uid, and the shader returns their colour without a fetch: 13 is `Texture.EMPTY`,
 * transparent black; 14 is `Texture.WHITE`; 15 is `NORMAL_MAP`, a flat normal. Slots 10 to 12
 * fall back to unit 9.
 */
const header = `
vec4 sampleBatchSlotGrad(uint slot, vec2 uv, vec2 uvDx, vec2 uvDy) {
  if (slot == 0u) return textureGrad(uBatchTexture0, uv, uvDx, uvDy);
  if (slot == 1u) return textureGrad(uBatchTexture1, uv, uvDx, uvDy);
  if (slot == 2u) return textureGrad(uBatchTexture2, uv, uvDx, uvDy);
  if (slot == 3u) return textureGrad(uBatchTexture3, uv, uvDx, uvDy);
  if (slot == 4u) return textureGrad(uBatchTexture4, uv, uvDx, uvDy);
  if (slot == 5u) return textureGrad(uBatchTexture5, uv, uvDx, uvDy);
  if (slot == 6u) return textureGrad(uBatchTexture6, uv, uvDx, uvDy);
  if (slot == 7u) return textureGrad(uBatchTexture7, uv, uvDx, uvDy);
  if (slot == 8u) return textureGrad(uBatchTexture8, uv, uvDx, uvDy);
  if (slot == 9u) return textureGrad(uBatchTexture9, uv, uvDx, uvDy);

  if (slot == 13u) return vec4(0.0);
  if (slot == 14u) return vec4(1.0);
  if (slot == 15u) return vec4(0.5, 0.5, 1.0, 1.0);

  return textureGrad(uBatchTexture9, uv, uvDx, uvDy);
}
`;

/**
 * GLSL compiler plugin that collects `textures` from each bit and generates a fragment-only
 * `sampleX(uv)` and a `sampleXDirect(uv)` for both stages per declared texture, in the
 * `textureGetters` slot
 *
 * `sampleX` takes its mip level from the UV derivatives, which only the fragment stage has.
 * `sampleXDirect` passes zero gradients, so it reads mip 0 and works in the vertex stage too. A
 * texture's slot is the 4-bit field of `vTextureSlots` at its position across the bits' `textures`
 * lists, the order in which `Mesh3DBatcherGl` packs `material._textures`.
 *
 * Also adds the batch texture bindings as a bit of their own, unless one is already there, before
 * the core GLSL plugins read the bits.
 * @internal
 */
export const texturesPluginGl: ShaderCompilerPlugin = {
  collectData(context) {
    if (!context.bits.some((b) => b.name === 'batchTexturesBindings')) {
      context.bits.unshift({
        name: 'batchTexturesBindings',
        bindings: {
          batch: {
            uBatchTexture0: 'texture_2d<f32>',
            uBatchTexture1: 'texture_2d<f32>',
            uBatchTexture2: 'texture_2d<f32>',
            uBatchTexture3: 'texture_2d<f32>',
            uBatchTexture4: 'texture_2d<f32>',
            uBatchTexture5: 'texture_2d<f32>',
            uBatchTexture6: 'texture_2d<f32>',
            uBatchTexture7: 'texture_2d<f32>',
            uBatchTexture8: 'texture_2d<f32>',
            uBatchTexture9: 'texture_2d<f32>',
          },
        },
        gl: {
          header,
        },
      });
    }
  },

  injectCode(context): Record<string, string> {
    let nextIndex = 0;
    const lines: string[] = [];
    const isFragment = context.stage === 'fragment';

    for (const bit of context.bits) {
      if (!bit.textures) continue;
      for (const name of bit.textures) {
        const funcName = `sample${name[0].toUpperCase()}${name.slice(1)}`;
        const shift = nextIndex * 4;

        lines.push(
          `vec4 ${funcName}Direct(vec2 uv) {`,
          `  return sampleBatchSlotGrad(${slotOf(shift)}, uv, vec2(0.0), vec2(0.0));`,
          `}`,
        );

        if (isFragment) {
          lines.push(
            `vec4 ${funcName}(vec2 uv) {`,
            `  return sampleBatchSlotGrad(${slotOf(shift)}, uv, dFdx(uv), dFdy(uv));`,
            `}`,
          );
        }

        nextIndex++;
      }
    }

    return { textureGetters: lines.join('\n') };
  },
};
