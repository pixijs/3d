import type { TexelField } from '../../shader/codegen/structTexelLayout';
import { layoutStructTexels } from '../../shader/codegen/structTexelLayout';
import type { StructDefinition } from '../../shader/ShaderBit';

interface WgslStructAccessorOptions {
  name: string;
  struct: string;
  fields: StructDefinition;
  /** WGSL for the row's first texel, in terms of the function's `index: u32` parameter */
  base: string;
  /** WGSL that loads one texel as a `vec4<u32>`, given its index in terms of `base` */
  load: (texel: string) => string;
  /** The fields to load; `undefined` loads every field */
  read?: ReadonlySet<string>;
}

function wgslFieldValue(entry: TexelField, texel: string): string {
  if (entry.type === 'mat2x2<f32>') {
    return `mat2x2<f32>(bitcast<vec2<f32>>(${texel}.xy), bitcast<vec2<f32>>(${texel}.zw))`;
  }

  const bits = `${texel}${entry.swizzle}`;

  return entry.scalar === 'u32' ? bits : `bitcast<${entry.type}>(${bits})`;
}

/**
 * WGSL twin of `generateGlslStructAccessor`
 * @internal
 */
export function generateWgslStructAccessor(options: WgslStructAccessorOptions): string {
  const lines: string[] = [];

  lines.push(`fn ${options.name}(index: u32) -> ${options.struct} {`);
  lines.push(`  let base = ${options.base};`);
  lines.push(`  var m: ${options.struct};`);

  for (const [texelIdx, entries] of layoutStructTexels(options.fields, options.read)) {
    lines.push(`  let t${texelIdx} = ${options.load(`base + ${texelIdx}`)};`);

    for (const entry of entries) {
      lines.push(`  m.${entry.name} = ${wgslFieldValue(entry, `t${texelIdx}`)};`);
    }
  }

  lines.push(`  return m;`);
  lines.push(`}`);

  return lines.join('\n');
}
