import type { VertexFormat } from 'pixi.js';

import type { ShaderBit } from '../ShaderBit';

const cache: Partial<Record<VertexFormat, ShaderBit>> = Object.create(null);

/**
 * Returns the UV shader bit for a source `aUV` `VertexFormat`, one cached
 * variant per format
 *
 * The bit reads `aUV` and writes it into the shared `uv: vec2<f32>` local that
 * downstream bits (baseColor sampling, KHR_texture_transform) consume.
 *
 * The unconditional `vec2<f32>` / `vec2` cast is a no-op for float-like
 * formats (`float32x2`, hardware-normalized `unorm/snorm{8,16}x2`) and the
 * required value conversion for raw integer formats (`uint/sint{8,16}x2`
 * from KHR_mesh_quantization with `normalized=false`). Both shader
 * compilers fold the no-op same-type constructor.
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
