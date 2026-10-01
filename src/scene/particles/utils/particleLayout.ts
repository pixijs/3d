import { getAttributeInfoFromFormat } from 'pixi.js';
import type { PointData, VertexFormat } from 'pixi.js';

import type { PointData3D } from '../../../math/vector/PointData3D';
import type { PointData4D } from '../../../math/vector/PointData4D';

/**
 * Bytes `aPosition` occupies at the head of every vertex
 * @internal
 */
const POSITION_BYTES = 12;

/**
 * Declared attributes the layout doesn't place in declaration order
 *
 * `aUV` is the per-corner id and streams from its own shared buffer;
 * `aPosition` is placed by the layout itself so it always leads the vertex. Each
 * still takes one of the {@link MAX_VERTEX_ATTRIBUTES} slots.
 * @internal
 */
const NOT_INTERLEAVED = new Set(['aUV', 'aPosition']);

/**
 * The vertex-input slots WebGL 2 and WebGPU both guarantee; past this the
 * failure is a pipeline error with no name in it
 * @internal
 */
const MAX_VERTEX_ATTRIBUTES = 16;

/**
 * One declared attribute, resolved into where it lives in a vertex and how
 * `ParticleContainer3D.setParticle` writes it
 *
 * `'color'` is the built-in tint: it takes a `ColorSource` and sRGB-decodes on
 * the way in, the same path `setParticleAt` uses. `'unsupported'` marks a format
 * the writer has no packer for yet; it only errors if something targets it.
 * @internal
 */
export interface ParticleAttribute {
  /** Storage format, as the bit declared it */
  format: VertexFormat;
  /** Byte offset within a vertex */
  offset: number;
  /** Index of the first element in the `f32` / `u32` view */
  index: number;
  /** Elements, and so the shape of value `setParticle` accepts */
  components: 1 | 2 | 3 | 4;
  /** The packer `setParticle` routes the value through */
  kind: 'float' | 'unorm8' | 'unorm16' | 'color' | 'unsupported';
}

/**
 * The attributes the composed bits declare, resolved into where each lives in
 * a vertex; see {@link buildParticleLayout}
 * @internal
 */
interface ParticleLayout {
  /** Attribute name to its resolved placement, in declaration order */
  attributes: Record<string, ParticleAttribute>;
  /** Bytes one vertex occupies */
  vertexStride: number;
}

/**
 * Resolves a declared attribute's placement and packer from its format
 * @param name - Attribute name; `aParticleColor` always gets the colour packer
 * @param format - Vertex format the bit declared
 * @param offset - Byte offset within a vertex
 * @internal
 */
function resolveParticleAttribute(name: string, format: VertexFormat, offset: number): ParticleAttribute {
  const index = offset / 4;

  if (name === 'aParticleColor') return { format, offset, index, components: 4, kind: 'color' };

  switch (format) {
    case 'float32':
      return { format, offset, index, components: 1, kind: 'float' };
    case 'float32x2':
      return { format, offset, index, components: 2, kind: 'float' };
    case 'float32x3':
      return { format, offset, index, components: 3, kind: 'float' };
    case 'float32x4':
      return { format, offset, index, components: 4, kind: 'float' };
    case 'unorm8x4':
      return { format, offset, index, components: 4, kind: 'unorm8' };
    case 'unorm16x4':
      return { format, offset, index, components: 4, kind: 'unorm16' };
    default:
      return { format, offset, index, components: 4, kind: 'unsupported' };
  }
}

/**
 * Throws when a value's shape doesn't match the attribute it targets
 * @param name - Attribute name, for the error message
 * @param value - Value to check
 * @param components - Components the attribute takes; 1 means a plain number
 * @internal
 */
export function expectShape(name: string, value: unknown, components: number): asserts value is PointData4D {
  const ok =
    components === 1
      ? typeof value === 'number'
      : typeof value === 'object' &&
        value !== null &&
        typeof (value as PointData).x === 'number' &&
        typeof (value as PointData).y === 'number' &&
        (components < 3 || typeof (value as PointData3D).z === 'number') &&
        (components < 4 || typeof (value as PointData4D).w === 'number');

  if (!ok) {
    const want = components === 1 ? 'a number' : `{ ${['x', 'y', 'z', 'w'].slice(0, components).join(', ')} }`;
    throw new Error(`[ParticleContainer3D] '${name}' takes ${want}, got ${JSON.stringify(value)}`);
  }
}

/**
 * Derives the interleaved vertex layout from the attributes the composed bits declare
 *
 * `aPosition` always leads: both material systems pick the position decode bit
 * by reading `geometry.attributes.aPosition`, so its name and format belong to
 * the engine. Everything else packs in declaration order, 4-byte aligned, which
 * every vertex format wants anyway. The same declarations generate the shader's
 * attribute inputs, so buffer and shader cannot disagree.
 * @param declared - Attribute name to vertex format, as the composed bits declare them
 * @internal
 */
export function buildParticleLayout(declared: Record<string, VertexFormat>): ParticleLayout {
  const attributes: Record<string, ParticleAttribute> = Object.create(null);
  let offset = POSITION_BYTES;

  attributes.aPosition = resolveParticleAttribute('aPosition', 'float32x3', 0);

  let count = NOT_INTERLEAVED.size;

  for (const [name, format] of Object.entries(declared)) {
    if (NOT_INTERLEAVED.has(name)) continue;

    offset = Math.ceil(offset / 4) * 4;
    attributes[name] = resolveParticleAttribute(name, format, offset);
    offset += getAttributeInfoFromFormat(format).stride;
    count++;
  }

  if (count > MAX_VERTEX_ATTRIBUTES) {
    throw new Error(
      `[ParticleContainer3D] the composed bits need ${count} vertex attributes and the GPU guarantees ` +
        `${MAX_VERTEX_ATTRIBUTES}. Pack some into fewer, wider formats.`,
    );
  }

  return { attributes, vertexStride: Math.ceil(offset / 4) * 4 };
}
