import type { VertexFormat } from 'pixi.js';

import type { ShaderBit } from '../ShaderBit';

const cache: Partial<Record<VertexFormat, ShaderBit>> = Object.create(null);

/**
 * Returns the bit that reads `aUV` in `format` into the vertex template's `uv` local, one cached
 * bit per format
 *
 * The `vec2<f32>(…)` constructor converts the raw integer formats `KHR_mesh_quantization` allows
 * for unnormalized UVs, such as `uint16x2`. For float and normalized formats it changes nothing.
 * @param format - Vertex format of the geometry's `aUV` attribute
 * @returns The cached ShaderBit for that format
 * @internal
 */
export function getUvsBit(format: VertexFormat): ShaderBit {
  const existing = cache[format];
  if (existing) return existing;

  const bit: ShaderBit = {
    name: `uvs:${format}`,
    overrideDefs: {
      HAS_UVS: { type: 'u32', required: true },
    },
    attributes: {
      aUV: format,
    },
    gpu: {
      vertex: {
        input: 'uv = vec2<f32>(input.aUV);',
      },
    },
    gl: {
      vertex: {
        input: 'uv = vec2(aUV);',
      },
    },
  };

  cache[format] = bit;
  return bit;
}
