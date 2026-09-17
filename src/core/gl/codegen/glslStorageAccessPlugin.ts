import { glTexelAddress } from '../../buffers/dataTextureLayout';
import { MATERIAL_STRIDE_FLOATS } from '../../buffers/MaterialDataStoreBuffer';
import { createStructLayout } from '../../shader/codegen/structLayout';
import type { StructDefinition } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

const SWIZZLE = 'xyzw';

/**
 * Generates a GLSL accessor function that reads a struct from a data texture
 *
 * Given a struct definition (WGSL field types) and a stride (in texels), produces
 * a GLSL function `get<StructName>(uint index)` that fetches texels from
 * `u<StructName>Storage` and populates a struct instance.
 *
 * The function groups fields that share the same texel into a single
 * `texelFetch` call and swizzles each field out of the fetched vec4.
 * @param structName - PascalCase struct name (e.g. "Material")
 * @param fields - Struct field definitions in WGSL types
 * @param strideTexels - Number of texels per entry in the data texture
 * @returns GLSL function source string
 * @internal
 */
export function generateGlslStorageAccessor(
  structName: string,
  fields: StructDefinition,
  strideTexels: number,
): string {
  const textureName = `u${structName}Storage`;

  const layout = createStructLayout(fields as Record<string, string>);

  // Group elements by the texel they occupy (each texel = 16 bytes = 4 floats).
  const texelGroups = new Map<number, { name: string; componentStart: number; components: number }[]>();

  for (const elem of layout.elements) {
    const texelIndex = Math.floor(elem.offset / 16);
    const componentStart = (elem.offset % 16) / 4;

    if (!texelGroups.has(texelIndex)) texelGroups.set(texelIndex, []);
    texelGroups.get(texelIndex)!.push({
      name: elem.name,
      componentStart,
      components: elem.components,
    });
  }

  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * Auto-generated from ${structName} struct bindings.`);
  lines.push(` * Reads properties from u${structName}Storage data texture and returns a`);
  lines.push(` * populated struct — use result.fieldName to access values.`);
  lines.push(` * Do not edit manually; regenerated during shader compilation.`);
  lines.push(` */`);
  lines.push(`${structName} get${structName}(uint index) {`);
  lines.push(`  int mi = int(index);`);
  lines.push(`  int base = mi * ${strideTexels};`);
  lines.push(`  ${structName} m;`);

  for (const [texelIdx, fieldEntries] of texelGroups) {
    lines.push(`  vec4 t${texelIdx} = texelFetch(${textureName}, ${glTexelAddress(`base + ${texelIdx}`)}, 0);`);

    for (const entry of fieldEntries) {
      if (entry.components === 4) {
        lines.push(`  m.${entry.name} = t${texelIdx};`);
      } else if (entry.components === 3) {
        lines.push(`  m.${entry.name} = t${texelIdx}.xyz;`);
      } else if (entry.components === 2) {
        const sw = SWIZZLE.slice(entry.componentStart, entry.componentStart + 2);

        lines.push(`  m.${entry.name} = t${texelIdx}.${sw};`);
      } else {
        const sw = SWIZZLE[entry.componentStart];

        lines.push(`  m.${entry.name} = t${texelIdx}.${sw};`);
      }
    }
  }

  lines.push(`  return m;`);
  lines.push(`}`);

  return lines.join('\n');
}

/**
 * GLSL compiler plugin that generates `get<StructName>()` accessor functions
 * for any struct backed by a data texture (storage buffer emulated via
 * texelFetch)
 *
 * The naming convention is: struct `Foo` -> texture `uFooStorage` -> function `getFoo()`.
 *
 * Runs after `glslBindingsPlugin` so `context.data.structs` is already populated.
 * Injects the accessor into the `header` slot so it's available in both vertex and
 * fragment shaders.
 * @internal
 */
export const glslStorageAccessPlugin: ShaderCompilerPlugin = {
  injectCode(context): Record<string, string> {
    const structs = context.data.structs;

    if (!structs) return {};

    const strideTexels = MATERIAL_STRIDE_FLOATS / 4;
    const accessors: string[] = [];

    // Check which structs have a matching `u<Name>Storage` texture declared
    // in the bindings. The bindings source is already generated, so we check
    // whether `u<Name>Storage` appears as a uniform somewhere in the bits.
    const bindGroupNames = new Set(context.template.bindGroups);

    for (const [structName, fields] of Object.entries(structs)) {
      const groupNameLower = structName.charAt(0).toLowerCase() + structName.slice(1);

      // Skip structs that are emitted as UBO/flat uniforms (they don't use storage textures)
      if (bindGroupNames.has(groupNameLower)) continue;

      // Check if any bit declares a storage or texture binding for `u<Name>Storage`
      const storageName = `u${structName}Storage`;
      let hasStorage = false;

      for (const bit of context.bits) {
        if (!bit.bindings) continue;
        for (const bindings of Object.values(bit.bindings)) {
          if (storageName in bindings!) {
            hasStorage = true;
            break;
          }
        }
        if (hasStorage) break;
      }

      if (!hasStorage) continue;

      accessors.push(generateGlslStorageAccessor(structName, fields, strideTexels));
    }

    if (accessors.length === 0) return {};

    return { header: accessors.join('\n\n') };
  },
};
