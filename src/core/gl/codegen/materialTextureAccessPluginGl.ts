import { glTexelAddress } from '../../buffers/dataTextureLayout';
import type { StructDefinition } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';
import { generateGlslStructAccessor } from './glslStructAccessor';

/** The GLSL twin of `generateWgslMaterialAccessor`; `index` is the material's first texel in `uMaterialStorage` */
function generateGlslMaterialAccessor(fields: StructDefinition): string {
  return generateGlslStructAccessor({
    name: 'getMaterial',
    struct: 'Material',
    fields,
    base: 'int(index)',
    load: (texel) => `texelFetch(uMaterialStorage, ${glTexelAddress(texel)}, 0)`,
  });
}

/**
 * The GLSL twin of `materialTextureAccessPlugin`. Emits `getMaterial()` into `{{textureGetters}}`, which templates
 * place after `{{header}}`, since GLSL needs `Material` and `uMaterialStorage` declared first.
 * @internal
 */
export const materialTextureAccessPluginGl: ShaderCompilerPlugin = {
  injectCode(context): Record<string, string> {
    const material = context.data.structs?.Material;

    if (!material) return {};

    return {
      textureGetters: generateGlslMaterialAccessor(material),
      storeAccess: 'Material material = getMaterial(vMaterialIndex);',
    };
  },
};
