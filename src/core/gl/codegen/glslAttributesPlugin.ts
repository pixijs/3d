import { warn } from 'pixi.js';
import type { VertexFormat } from 'pixi.js';

import type { ShaderBit } from '../../shader/ShaderBit';
import type { ShaderCompilerPlugin } from '../../shader/ShaderCompilerPlugin';

/** Maps VertexFormat to GLSL types */
const FORMAT_TO_GLSL: Record<VertexFormat, string> = {
  // 32-bit floats
  float32: 'float',
  float32x2: 'vec2',
  float32x3: 'vec3',
  float32x4: 'vec4',

  // 32-bit signed integers
  sint32: 'int',
  sint32x2: 'ivec2',
  sint32x3: 'ivec3',
  sint32x4: 'ivec4',

  // 32-bit unsigned integers
  uint32: 'uint',
  uint32x2: 'uvec2',
  uint32x3: 'uvec3',
  uint32x4: 'uvec4',

  // 16-bit floats (normalized in GLSL)
  float16x2: 'vec2',
  float16x4: 'vec4',

  // 8-bit normalized unsigned
  unorm8x2: 'vec2',
  unorm8x4: 'vec4',

  // 8-bit normalized signed
  snorm8x2: 'vec2',
  snorm8x4: 'vec4',

  // 8-bit unsigned integers
  uint8x2: 'uvec2',
  uint8x4: 'uvec4',

  // 8-bit signed integers
  sint8x2: 'ivec2',
  sint8x4: 'ivec4',

  // 16-bit normalized unsigned
  unorm16x2: 'vec2',
  unorm16x4: 'vec4',

  // 16-bit normalized signed
  snorm16x2: 'vec2',
  snorm16x4: 'vec4',

  // 16-bit unsigned integers
  uint16x2: 'uvec2',
  uint16x4: 'uvec4',

  // 16-bit signed integers
  sint16x2: 'ivec2',
  sint16x4: 'ivec4',
};

function toGlslType(format: VertexFormat): string {
  const mapped = FORMAT_TO_GLSL[format];
  if (!mapped) {
    warn(`[compileAttributesGlsl] Unknown vertex format: "${format}"`);
    return 'vec4'; // fallback
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
   * Whether to include explicit layout(location) declarations
   * @default true (WebGL2 style)
   */
  useLocations?: boolean;
}

/**
 * Compiles shader attributes from bits into GLSL vertex input declarations
 *
 * - Deduplicates attributes across bits (warns if formats conflict)
 * - Supports explicit layout(location) for WebGL2
 * - Maps VertexFormat to appropriate GLSL types
 * @example
 * ```ts
 * // With layout locations (WebGL2)
 * const glsl = compileAttributesGlsl(bits);
 * // layout(location = 0) in vec3 aPosition;
 * // layout(location = 1) in vec2 aUV;
 *
 * // Without layout locations (WebGL1 compatible)
 * const glsl = compileAttributesGlsl(bits, { useLocations: false });
 * // in vec3 aPosition;
 * // in vec2 aUV;
 * ```
 * @param bits - Array of shader bits containing attribute definitions
 * @param options - Optional settings
 * @returns GLSL source string with attribute declarations
 * @internal
 */
function compileAttributesGlsl(bits: ShaderBit[], options: CompileAttributesGlslOptions = {}): string {
  const { useLocations = true } = options;

  // Collect attributes from all bits, deduplicating
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

  // Generate output
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
