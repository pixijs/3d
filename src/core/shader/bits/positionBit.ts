import type { VertexFormat } from 'pixi.js';

import type { ShaderBit } from '../ShaderBit';

/**
 * Divisor applied in the vertex shader to recover integer-space positions from
 * hardware-normalized (snorm/unorm) values
 *
 * KHR_mesh_quantization stores positions as Int8/Uint8/Int16/Uint16 and the
 * exporter bakes `node.scale = S/D`. Hardware normalization maps the integer
 * range to `[-1, 1]` / `[0, 1]`; multiplying by the divisor in-shader restores
 * the original integer value `Q`, after which `node.scale * Q = V` (final world
 * value) -- identical to the uncompressed mesh.
 *
 * Float formats use `1.0` so the multiply folds out and the float and
 * quantized paths share a single bit factory.
 */
const FORMAT_TO_DIVISOR: Partial<Record<VertexFormat, string>> = {
  float32x3: '1.0',
  float32x4: '1.0',
  snorm8x4: '127.0',
  unorm8x4: '255.0',
  snorm16x4: '32767.0',
  unorm16x4: '65535.0',
};

const cache: Partial<Record<VertexFormat, ShaderBit>> = Object.create(null);

/**
 * Returns the position bit variant for a source `aPosition` `VertexFormat`
 *
 * The bit reads `aPosition`, applies the KHR_mesh_quantization dequantization
 * divisor (a no-op for float formats), and writes the result into the
 * shared `position: vec4<f32>` local that downstream bits (skinning,
 * world transform) consume.
 *
 * Runs before the skinning bit so skinned and static meshes share the
 * same dequantization path.
 *
 * The divisor is inlined as a literal so each variant compiles to a
 * single constant multiply (or zero ops for float formats).
 * @param format - The geometry's `aPosition` vertex format
 * @returns The cached position bit for that format
 * @internal
 */
export function getPositionBit(format: VertexFormat): ShaderBit {
  const existing = cache[format];
  if (existing) return existing;

  const divisor = FORMAT_TO_DIVISOR[format];
  if (!divisor) {
    throw new Error(`[positionBit] Unsupported aPosition format: ${format}`);
  }

  // float32x3 reads aPosition as vec3 directly; everything else is vec4 → take .xyz.
  const isVec3 = format === 'float32x3';
  const xyzGl = isVec3 ? 'aPosition' : 'aPosition.xyz';
  const xyzGpu = isVec3 ? 'input.aPosition' : 'input.aPosition.xyz';
  const mul = divisor === '1.0' ? '' : ` * ${divisor}`;

  const bit: ShaderBit = {
    name: `position:${format}`,
    attributes: {
      aPosition: format,
    },
    gpu: {
      vertex: {
        input: `position = vec4<f32>(${xyzGpu}${mul}, 1.0);`,
      },
    },
    gl: {
      vertex: {
        input: `position = vec4(${xyzGl}${mul}, 1.0);`,
      },
    },
  };

  cache[format] = bit;
  return bit;
}
