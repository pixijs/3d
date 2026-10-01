import { warn } from 'pixi.js';
import type { VertexFormat } from 'pixi.js';

import type { ShaderBit } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/** The GLSL type an attribute of each vertex format reads as: normalized and half-float formats as float vectors */
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

/**
 * Options for `compileAttributesGlsl`
 * @internal
 */
interface CompileAttributesGlslOptions {
  /**
   * Whether to declare `layout(location = n)` on each attribute
   * @default true
   */
  useLocations?: boolean;
}

/**
 * Compiles shader attributes from bits into GLSL vertex input declarations
 *
 * Declares each attribute once, as `in vec3 aPosition;`, in the order the bits first name them. A
 * later bit naming it with another format warns and keeps the first. With `useLocations`, the
 * attributes take locations 0, 1, 2 and so on in that order; without, pixi reads the locations the
 * linker picked.
 * @param bits - Array of shader bits containing attribute definitions
 * @param options - Optional settings
 * @returns GLSL source string with attribute declarations
 * @internal
 */
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

/**
 * GLSL compiler plugin that collects attribute declarations once (on the vertex
 * pass) and injects them into the vertex `{{header}}` slot
 * @internal
 */
export const glslAttributesPlugin: ShaderCompilerPlugin = {
  collectData(context) {
    if (context.stage === 'vertex' && !context.data.attributes) {
      context.data.attributes = compileAttributesGlsl(context.bits, {
        useLocations: context.glslOptions?.useLocations,
      }) as any;
    }
  },
  injectCode(context): Record<string, string> {
    if (context.stage === 'vertex') {
      return { header: context.data.attributes as any };
    }
    return {};
  },
};
