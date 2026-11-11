import { glTexelAddress, WORDS_PER_TEXEL } from '../../buffers/dataTextureLayout';
import type { InstanceAccess } from '../../shader/codegen/instanceAccess';
import { instanceVaryingName, readsInstanceData, resolveInstanceAccess } from '../../shader/codegen/instanceAccess';
import type { InterStageType, ShaderBit } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';
import { generateGlslStructAccessor } from './glslStructAccessor';

/**
 * Reads `renderInstance.x`, the mesh store row that `instanceFetchBitGl` declares, so the template must list that bit
 */
function createInstanceAccessBitGl(access: InstanceAccess): ShaderBit {
  const { layout, loaded, varyings } = access;
  const interStage: Record<string, InterStageType> = {};
  const vertex: string[] = ['Instance instance = getInstance(renderInstance.x);'];
  const fragment: string[] = ['Instance instance;'];

  for (const name of varyings) {
    const type = layout.struct[name];
    const varying = instanceVaryingName(name);
    const asBits =
      type === 'vec4<f32>'
        ? `floatBitsToUint(instance.${name})`
        : type === 'vec4<i32>'
          ? `uvec4(instance.${name})`
          : `instance.${name}`;
    const fromBits =
      type === 'vec4<f32>' ? `uintBitsToFloat(${varying})` : type === 'vec4<i32>' ? `ivec4(${varying})` : varying;

    interStage[varying] = 'vec4<u32>';
    vertex.push(`${varying} = ${asBits};`);
    fragment.push(`instance.${name} = ${fromBits};`);
  }

  return {
    name: `instanceAccess:${layout.key}`,
    interStage,
    bindings: {
      global: {
        uInstanceStoreTexture: 'texture_2d<u32>',
      },
    },
    gl: {
      vertex: {
        header: generateGlslStructAccessor({
          name: 'getInstance',
          struct: 'Instance',
          fields: layout.struct,
          read: loaded,
          base: `int(index) * ${layout.stride / WORDS_PER_TEXEL}`,
          load: (texel) => `texelFetch(uInstanceStoreTexture, ${glTexelAddress(texel)}, 0)`,
        }),
        storeAccess: vertex.join('\n  '),
      },
      fragment: varyings.length ? { storeAccess: fragment.join('\n  ') } : undefined,
    },
  };
}

/**
 * The GLSL twin of `instanceAccessPlugin`
 * @internal
 */
export const instanceAccessPluginGl: ShaderCompilerPlugin = {
  collectData(context): void {
    if (!readsInstanceData(context.bits)) return;

    const access = resolveInstanceAccess(context.bits, 'gl', context.instanceLayout, context.template);

    context.bits = [...context.bits, createInstanceAccessBitGl(access)];
  },
};
