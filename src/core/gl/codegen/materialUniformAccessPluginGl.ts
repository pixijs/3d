import type { StructDefinition } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';
import { mat2ColumnMember, uniformBlockInstanceName } from './glslBindingsPlugin';

const BLOCK = uniformBlockInstanceName('material');

function generateGlslMaterialUniformAccessor(fields: StructDefinition): string {
  const lines = [`Material getMaterial() {`, `  Material m;`];
  for (const name in fields) {
    const value =
      fields[name] === 'mat2x2<f32>'
        ? `mat2(${BLOCK}.${mat2ColumnMember(name, 0)}, ${BLOCK}.${mat2ColumnMember(name, 1)})`
        : `${BLOCK}.${name}`;
    lines.push(`  m.${name} = ${value};`);
  }
  lines.push(`  return m;`, `}`);

  return lines.join('\n');
}

/**
 * Copies the `uMaterial` block into a `material` local so bits read `material.<field>` as they do on WebGPU. Pairs
 * with `createTexturesPluginGl('direct')`, whose bindings bit declares the block.
 * @internal
 */
export const materialUniformAccessPluginGl: ShaderCompilerPlugin = {
  injectCode(context): Record<string, string> {
    const material = context.data.structs?.Material;

    if (!material) return {};

    return {
      textureGetters: generateGlslMaterialUniformAccessor(material),
      storeAccess: 'Material material = getMaterial();',
    };
  },
};
