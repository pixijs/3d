import type { TexelField } from '../../shader/codegen/structTexelLayout';
import { layoutStructTexels } from '../../shader/codegen/structTexelLayout';
import type { StructDefinition } from '../../shader/ShaderBit';

interface GlslStructAccessorOptions {
  name: string;
  struct: string;
  fields: StructDefinition;
  base: string;
  load: (texel: string) => string;
  read?: ReadonlySet<string>;
}

function glslFieldValue(entry: TexelField, texel: string): string {
  if (entry.type === 'mat2x2<f32>') return `mat2(uintBitsToFloat(${texel}.xy), uintBitsToFloat(${texel}.zw))`;

  const bits = `${texel}${entry.swizzle}`;

  if (entry.scalar === 'u32') return bits;
  if (entry.scalar === 'i32') return `${entry.type === 'vec4<i32>' ? 'ivec4' : 'int'}(${bits})`;

  return `uintBitsToFloat(${bits})`;
}

/**
 * The GLSL twin of `generateWgslStructAccessor`; the struct and whatever `load` names must be declared above it
 * @internal
 */
export function generateGlslStructAccessor(options: GlslStructAccessorOptions): string {
  const lines: string[] = [];

  lines.push(`${options.struct} ${options.name}(uint index) {`);
  lines.push(`  int base = ${options.base};`);
  lines.push(`  ${options.struct} m;`);

  for (const [texelIdx, entries] of layoutStructTexels(options.fields, options.read)) {
    lines.push(`  uvec4 t${texelIdx} = ${options.load(`base + ${texelIdx}`)};`);

    for (const entry of entries) {
      lines.push(`  m.${entry.name} = ${glslFieldValue(entry, `t${texelIdx}`)};`);
    }
  }

  lines.push(`  return m;`);
  lines.push(`}`);

  return lines.join('\n');
}
