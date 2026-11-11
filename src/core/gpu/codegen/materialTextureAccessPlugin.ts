import { wgslTexelAddress } from '../../buffers/dataTextureLayout';
import type { StructDefinition } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';
import { generateWgslStructAccessor } from './wgslStructAccessor';

function generateWgslMaterialAccessor(fields: StructDefinition): string {
  return generateWgslStructAccessor({
    name: 'getMaterial',
    struct: 'Material',
    fields,
    base: 'i32(index)',
    load: (texel) => `textureLoad(uMaterialStorage, ${wgslTexelAddress(texel)}, 0)`,
  });
}

/**
 * Reads the store as a texture, not a storage buffer: on Metal with a multisampled target, one fragment
 * storage read slows everything after it several times; `materialTextureAccessPluginGl` is the twin
 * @internal
 */
export const materialTextureAccessPlugin: ShaderCompilerPlugin = {
  injectCode(context): Record<string, string> {
    const material = context.data.structs?.Material;

    if (!material) return {};

    const access = 'var material = getMaterial(vMaterialIndex);';

    return {
      textureGetters: generateWgslMaterialAccessor(material),
      vertexStoreAccess: access,
      fragmentStoreAccess: access,
    };
  },
};
