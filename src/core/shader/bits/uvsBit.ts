import type { VertexFormat } from 'pixi.js';

import type { ShaderBit } from '../ShaderBit';

const cache: Partial<Record<VertexFormat, ShaderBit>> = Object.create(null);

/**
 * The `vec2<f32>(…)` converts a raw integer format, which `KHR_mesh_quantization` allows
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
