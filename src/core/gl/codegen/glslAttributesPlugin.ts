import { warn } from 'pixi.js';
import type { VertexFormat } from 'pixi.js';

import type { ShaderBit } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

const FORMAT_TO_GLSL: Record<VertexFormat, string> = {
  float32: 'float',
  float32x2: 'vec2',
  float32x3: 'vec3',
  float32x4: 'vec4',

  sint32: 'int',
  sint32x2: 'ivec2',
  sint32x3: 'ivec3',
  sint32x4: 'ivec4',

  uint32: 'uint',
  uint32x2: 'uvec2',
  uint32x3: 'uvec3',
  uint32x4: 'uvec4',

  float16x2: 'vec2',
  float16x4: 'vec4',

  unorm8x2: 'vec2',
  unorm8x4: 'vec4',

  snorm8x2: 'vec2',
  snorm8x4: 'vec4',

  uint8x2: 'uvec2',
  uint8x4: 'uvec4',

  sint8x2: 'ivec2',
  sint8x4: 'ivec4',

  unorm16x2: 'vec2',
  unorm16x4: 'vec4',

  snorm16x2: 'vec2',
  snorm16x4: 'vec4',

  uint16x2: 'uvec2',
  uint16x4: 'uvec4',

  sint16x2: 'ivec2',
  sint16x4: 'ivec4',
};

function toGlslType(format: VertexFormat): string {
  const mapped = FORMAT_TO_GLSL[format];
  if (!mapped) {
    warn(`[compileAttributesGlsl] Unknown vertex format: "${format}"`);
    return 'vec4';
  }
  return mapped;
}

function warnAttributeConflict(name: string, newFormat: string, existingFormat: string): void {
  warn(
    `[compileAttributesGlsl] Attribute "${name}" redefined with different format: ` +
      `"${existingFormat}" → "${newFormat}". Keeping original.`,
  );
}

interface CompileAttributesGlslOptions {
  useLocations?: boolean;
}

function compileAttributesGlsl(bits: ShaderBit[], options: CompileAttributesGlslOptions = {}): string {
  const { useLocations = true } = options;

  const attributes = new Map<string, VertexFormat>();

  for (const bit of bits) {
    if (!bit.attributes) continue;

    for (const [name, format] of Object.entries(bit.attributes)) {
      if (!attributes.has(name)) {
        attributes.set(name, format);
      } else if (attributes.get(name) !== format) {
        warnAttributeConflict(name, format, attributes.get(name)!);
      }
    }
  }

  const out: string[] = [];
  let locationIndex = 0;

  for (const [name, format] of attributes) {
    const glslType = toGlslType(format);

    if (useLocations) {
      out.push(`layout(location = ${locationIndex++}) in ${glslType} ${name};`);
    } else {
      out.push(`in ${glslType} ${name};`);
    }
  }

  return out.join('\n');
}

/** @internal */
export const glslAttributesPlugin: ShaderCompilerPlugin = {
  collectData(context) {
    if (context.stage === 'vertex') {
      const glsl = (context.data.glsl ??= {});
      glsl.attributes ??= compileAttributesGlsl(context.bits, {
        useLocations: context.glslOptions?.useLocations,
      });
    }
  },
  injectCode(context): Record<string, string> {
    if (context.stage === 'vertex') {
      return { header: context.data.glsl!.attributes! };
    }
    return {};
  },
};
