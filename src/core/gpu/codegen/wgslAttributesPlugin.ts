import { warn } from 'pixi.js';
import type { VertexFormat } from 'pixi.js';

import { collectAttributes } from '../../shader/codegen/collectAttributes';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

const FORMAT_TO_WGSL: Record<VertexFormat, string> = {
  float32: 'f32',
  float32x2: 'vec2<f32>',
  float32x3: 'vec3<f32>',
  float32x4: 'vec4<f32>',

  sint32: 'i32',
  sint32x2: 'vec2<i32>',
  sint32x3: 'vec3<i32>',
  sint32x4: 'vec4<i32>',

  uint32: 'u32',
  uint32x2: 'vec2<u32>',
  uint32x3: 'vec3<u32>',
  uint32x4: 'vec4<u32>',

  float16x2: 'vec2<f32>',
  float16x4: 'vec4<f32>',

  unorm8x2: 'vec2<f32>',
  unorm8x4: 'vec4<f32>',

  snorm8x2: 'vec2<f32>',
  snorm8x4: 'vec4<f32>',

  uint8x2: 'vec2<u32>',
  uint8x4: 'vec4<u32>',

  sint8x2: 'vec2<i32>',
  sint8x4: 'vec4<i32>',

  unorm16x2: 'vec2<f32>',
  unorm16x4: 'vec4<f32>',

  snorm16x2: 'vec2<f32>',
  snorm16x4: 'vec4<f32>',

  uint16x2: 'vec2<u32>',
  uint16x4: 'vec4<u32>',

  sint16x2: 'vec2<i32>',
  sint16x4: 'vec4<i32>',
};

function toWgslType(format: VertexFormat): string {
  const mapped = FORMAT_TO_WGSL[format];
  if (!mapped) {
    warn(`[compileAttributesWgsl] Unknown vertex format: "${format}"`);
    return 'vec4<f32>';
  }
  return mapped;
}

function emitAttributesWgsl(attributes: Record<string, VertexFormat>): string {
  const names = Object.keys(attributes);
  if (names.length === 0) return '';

  const out: string[] = [];
  out.push('struct VertexInput {');

  let locationIndex = 0;
  for (const name of names) {
    const wgslType = toWgslType(attributes[name]);
    out.push(`  @location(${locationIndex++}) ${name}: ${wgslType},`);
  }

  out.push('}');
  return out.join('\n');
}

/** @internal */
export const wgslAttributesPlugin: ShaderCompilerPlugin = {
  collectData(context) {
    context.data.attributes = collectAttributes(context.bits);
  },
  injectCode(context) {
    const attributesSource = emitAttributesWgsl(context.data.attributes!);
    return { header: attributesSource };
  },
};
