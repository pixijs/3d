import { collectTextureNames } from '../../../materials/utils/validateMaterialTextureSlots';
import { materialBindingsBit } from '../../shader/bits/materialBindingsBit';
import type { MaterialShaderForm } from '../../shader/bits/materialBindingsBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

function textureGetters(funcName: string, index: number, isFragment: boolean): string[] {
  const lines = [`vec4 ${funcName}Direct(vec2 uv) {`, `  return textureLod(uMaterialTexture${index}, uv, 0.0);`, `}`];
  if (isFragment) lines.push(`vec4 ${funcName}(vec2 uv) {`, `  return texture(uMaterialTexture${index}, uv);`, `}`);

  return lines;
}

/**
 * Adds the same `materialBindingsBit` as `createTexturesPluginGpu`, sampler entries included, so both backends give
 * texture `t` the same binding index
 * @internal
 */
export function createTexturesPluginGl(form: MaterialShaderForm): ShaderCompilerPlugin {
  return {
    collectData(context) {
      if (!context.bits.some((b) => b.name.startsWith('materialBindings:'))) {
        context.bits.unshift(materialBindingsBit(context.bits, form));
      }
    },

    injectCode(context): Record<string, string> {
      const names = collectTextureNames(context.bits);
      const lines: string[] = [];
      const isFragment = context.stage === 'fragment';

      for (let i = 0; i < names.length; i++) {
        lines.push(...textureGetters(`sample${names[i][0].toUpperCase()}${names[i].slice(1)}`, i, isFragment));
      }

      return { textureGetters: lines.join('\n') };
    },
  };
}
