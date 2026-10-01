import { wgslTexelAddress } from '../../buffers/dataTextureLayout';
import type { MaterialTexelField } from '../../shader/codegen/materialTexelLayout';
import { layoutMaterialTexels, MATERIAL_STRIDE_TEXELS } from '../../shader/codegen/materialTexelLayout';
import type { StructDefinition } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/**
 * The WGSL expression that reads one field out of its texel
 * @param entry - The field and its place in the texel
 * @param texel - Name of the `vec4<u32>` holding the texel
 */
function wgslFieldValue(entry: MaterialTexelField, texel: string): string {
  if (entry.type === 'mat2x2<f32>') {
    return `mat2x2<f32>(bitcast<vec2<f32>>(${texel}.xy), bitcast<vec2<f32>>(${texel}.zw))`;
  }

  const bits = `${texel}${entry.swizzle}`;

  return entry.scalar === 'u32' ? bits : `bitcast<${entry.type}>(${bits})`;
}

/**
 * Generates the WGSL `getMaterial()` that rebuilds a Material from its row in `uMaterialStorage`
 *
 * Fields sharing a texel share one `textureLoad`, and only the texels the struct reaches are
 * loaded. The store is an `rgba32uint` texture, so a texel is a `vec4<u32>` of exact bits: a `u32`
 * field is read directly and every other type through `bitcast`. A `mat2x2<f32>` is rebuilt from
 * the texel's two halves as columns. The GLSL twin is `generateGlslMaterialAccessor`.
 * @param fields - The packed Material struct
 * @returns WGSL function source
 */
function generateWgslMaterialAccessor(fields: StructDefinition): string {
  const lines: string[] = [];

  lines.push(`fn getMaterial(index: u32) -> Material {`);
  lines.push(`  let base = i32(index) * ${MATERIAL_STRIDE_TEXELS};`);
  lines.push(`  var m: Material;`);

  for (const [texelIdx, entries] of layoutMaterialTexels(fields)) {
    lines.push(`  let t${texelIdx} = textureLoad(uMaterialStorage, ${wgslTexelAddress(`base + ${texelIdx}`)}, 0);`);

    for (const entry of entries) {
      lines.push(`  m.${entry.name} = ${wgslFieldValue(entry, `t${texelIdx}`)};`);
    }
  }

  lines.push(`  return m;`);
  lines.push(`}`);

  return lines.join('\n');
}

/**
 * Emits the WebGPU material accessor and the `material` local in each stage
 *
 * `getMaterial()` goes in the module-scope `{{textureGetters}}` slot. The `material` local goes in
 * `{{vertexMaterialAccess}}` and `{{fragmentMaterialAccess}}`, reading the `vMaterialIndex` each
 * stage of the template defines.
 *
 * The row comes from a data texture rather than a storage buffer. On Metal with a multisampled
 * target, one storage read in the fragment stage makes everything after it several times slower,
 * and a `textureLoad` doesn't.
 *
 * The WebGL twin is `materialTextureAccessPluginGl`. A shader whose bits declare no material
 * fields gets no struct, accessor or local, and compiles without them.
 * @internal
 */
export const materialTextureAccessPlugin: ShaderCompilerPlugin = {
  injectCode(context): Record<string, string> {
    const material = context.data.structs?.Material;

    if (!material) return {};

    const access = 'var material = getMaterial(vMaterialIndex);';

    return {
      textureGetters: generateWgslMaterialAccessor(material),
      vertexMaterialAccess: access,
      fragmentMaterialAccess: access,
    };
  },
};
