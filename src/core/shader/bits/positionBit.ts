import type { VertexFormat } from 'pixi.js';

import type { ShaderBit } from '../ShaderBit';

/**
 * What the vertex shader multiplies a position by to get back the integer a quantized format holds
 *
 * `Geometry3D` uploads integer positions in normalized formats, which the hardware maps to
 * [-1, 1] or [0, 1]. The divisor undoes that, so the shader sees the stored integer and the node's
 * transform scales it to the real position, as `KHR_mesh_quantization` lays out for unnormalized
 * positions. Float formats map to `1.0`, which the bit leaves out.
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
 * Returns the bit that reads `aPosition` in `format` into the vertex template's `position` local
 *
 * Every format but `float32x3` has four components, and the bit takes their `xyz`. It multiplies a
 * quantized position by its divisor, written in as a literal, so each variant costs one constant
 * multiply, or none for floats. `w` is 1.
 *
 * The renderer adds it ahead of the morph and skinning bits, so they deform the decoded position.
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
