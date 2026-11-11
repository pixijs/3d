import { WORDS_PER_TEXEL } from '../../buffers/dataTextureLayout';
import type { InstanceAccess } from '../../shader/codegen/instanceAccess';
import { instanceVaryingName, readsInstanceData, resolveInstanceAccess } from '../../shader/codegen/instanceAccess';
import type { InterStageType, ShaderBit } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';
import { generateWgslStructAccessor } from './wgslStructAccessor';

/**
 * The fragment stage never reads the store, which is slow on some GPUs; its fields cross as flat
 * varyings of their exact bits
 */
function createInstanceAccessBitGpu(access: InstanceAccess): ShaderBit {
  const { layout, loaded, varyings } = access;
  const interStage: Record<string, InterStageType> = {};
  const vertex: string[] = ['let instance = getInstance(inst.id);'];
  const fragment: string[] = ['var instance: Instance;'];

  for (const name of varyings) {
    const type = layout.struct[name];
    const varying = instanceVaryingName(name);
    const asBits = type === 'vec4<u32>' ? `instance.${name}` : `bitcast<vec4<u32>>(instance.${name})`;
    const fromBits = type === 'vec4<u32>' ? `input.${varying}` : `bitcast<${type}>(input.${varying})`;

    interStage[varying] = 'vec4<u32>';
    vertex.push(`output.${varying} = ${asBits};`);
    fragment.push(`instance.${name} = ${fromBits};`);
  }

  return {
    name: `instanceAccess:${layout.key}`,
    interStage,
    bindings: {
      global: {
        uInstanceStorage: { type: 'storage<vec4<u32>>', visibility: 'vertex' },
      },
    },
    gpu: {
      vertex: {
        header: generateWgslStructAccessor({
          name: 'getInstance',
          struct: 'Instance',
          fields: layout.struct,
          read: loaded,
          base: `index * ${layout.stride / WORDS_PER_TEXEL}u`,
          load: (texel) => `uInstanceStorage[${texel}]`,
        }),
        storeAccess: vertex.join('\n  '),
      },
      fragment: varyings.length ? { storeAccess: fragment.join('\n  ') } : undefined,
    },
  };
}

/**
 * WebGPU twin of `instanceAccessPluginGl`; must run before the plugins that collect bindings and
 * varyings, as `compileWgslSource` orders them
 * @internal
 */
export const instanceAccessPlugin: ShaderCompilerPlugin = {
  collectData(context): void {
    if (!readsInstanceData(context.bits)) return;

    const access = resolveInstanceAccess(context.bits, 'gpu', context.instanceLayout, context.template);

    context.bits = [...context.bits, createInstanceAccessBitGpu(access)];
  },
};
