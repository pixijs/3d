import { glTexelAddress } from '../../buffers/dataTextureLayout';
import type { MaterialTexelField } from '../../shader/codegen/materialTexelLayout';
import { layoutMaterialTexels, MATERIAL_STRIDE_TEXELS } from '../../shader/codegen/materialTexelLayout';
import type { StructDefinition } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/**
 * The GLSL expression that reads one field out of its texel
 * @param entry - The field and its place in the texel
 * @param texel - Name of the `uvec4` holding the texel
 */
function glslFieldValue(entry: MaterialTexelField, texel: string): string {
  if (entry.type === 'mat2x2<f32>') return `mat2(uintBitsToFloat(${texel}.xy), uintBitsToFloat(${texel}.zw))`;

  const bits = `${texel}${entry.swizzle}`;

  if (entry.scalar === 'u32') return bits;
  if (entry.scalar === 'i32') return `int(${bits})`;

  return `uintBitsToFloat(${bits})`;
}

/**
 * Generates the GLSL `getMaterial()` that rebuilds a Material from its row in `uMaterialStorage`
 *
 * A row is `MATERIAL_STRIDE_TEXELS` texels. Fields sharing a texel share one `texelFetch`, and only
 * the texels the struct reaches are fetched. The store is an `rgba32uint` texture, so a texel is a
 * `uvec4` of exact bits: a `u32` field is read directly, an `i32` through `int()`, which keeps the
 * bit pattern, and a float field through `uintBitsToFloat`. A `mat2x2<f32>` fills its texel as two
 * columns, `.xy` then `.zw`. The WGSL twin is `generateWgslMaterialAccessor`.
 * @param fields - The packed Material struct
 * @returns GLSL function source
 * @internal
 */
export function generateGlslMaterialAccessor(fields: StructDefinition): string {
  const lines: string[] = [];

  lines.push(`Material getMaterial(uint index) {`);
  lines.push(`  int base = int(index) * ${MATERIAL_STRIDE_TEXELS};`);
  lines.push(`  Material m;`);

  for (const [texelIdx, entries] of layoutMaterialTexels(fields)) {
    lines.push(`  uvec4 t${texelIdx} = texelFetch(uMaterialStorage, ${glTexelAddress(`base + ${texelIdx}`)}, 0);`);

    for (const entry of entries) {
      lines.push(`  m.${entry.name} = ${glslFieldValue(entry, `t${texelIdx}`)};`);
    }
  }

  lines.push(`  return m;`);
  lines.push(`}`);

  return lines.join('\n');
}

/**
 * Emits the WebGL material accessor and the `material` local in both stages
 *
 * `getMaterial()` goes in `{{textureGetters}}`, which the template places after `{{header}}`.
 * GLSL needs `Material` and `uMaterialStorage` declared before the accessor names them, and the
 * header declares both. The `material` local goes in `{{materialAccess}}` in each stage.
 *
 * The WebGPU twin is `materialTextureAccessPlugin`. A shader whose bits declare no material
 * fields gets no struct, accessor or local, and compiles without them.
 * @internal
 */
export const materialTextureAccessPluginGl: ShaderCompilerPlugin = {
  injectCode(context): Record<string, string> {
    const material = context.data.structs?.Material;

    if (!material) return {};

    return {
      textureGetters: generateGlslMaterialAccessor(material),
      materialAccess: 'Material material = getMaterial(vMaterialIndex);',
    };
  },
};
