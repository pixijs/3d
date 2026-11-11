import { getAttributeInfoFromFormat } from 'pixi.js';
import type { PointData, VertexFormat } from 'pixi.js';

import type { PointData3D } from '../../../math/vector/PointData3D';
import type { PointData4D } from '../../../math/vector/PointData4D';

const POSITION_BYTES = 12;

/** Kept out of the interleaved order, though each still counts toward {@link MAX_VERTEX_ATTRIBUTES} */
const NOT_INTERLEAVED = new Set(['aUV', 'aPosition']);

/** The vertex inputs WebGL 2 and WebGPU both guarantee */
const MAX_VERTEX_ATTRIBUTES = 16;

/** @internal */
export interface ParticleAttribute {
  format: VertexFormat;
  offset: number;
  /** `offset` in 32-bit elements */
  index: number;
  components: 1 | 2 | 3 | 4;
  /** `'unsupported'` has no packer, and throws only when `setParticle` writes it */
  kind: 'float' | 'unorm8' | 'unorm16' | 'color' | 'unsupported';
}

interface ParticleLayout {
  attributes: Record<string, ParticleAttribute>;
  vertexStride: number;
}

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
 * Throws unless `value` has the shape the attribute takes
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
 * `aPosition` leads as `float32x3`: `ParticleContainerViews` promises it at offset 0, and the material
 * systems pick the position bit by its format.
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
