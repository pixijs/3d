import { getAttributeInfoFromFormat } from 'pixi.js';
import type { VertexFormat } from 'pixi.js';

import type { ShaderBit } from '../ShaderBit';

const cache: Partial<Record<VertexFormat, ShaderBit>> = Object.create(null);

/**
 * The `vec3<f32>(…)` converts a raw integer format, which `KHR_mesh_quantization` allows
 * @internal
 */
export function getPositionBit(format: VertexFormat): ShaderBit {
  const existing = cache[format];
  if (existing) return existing;

  if (getAttributeInfoFromFormat(format).size < 3) {
    throw new Error(`[positionBit] aPosition needs three components, got ${format}`);
  }

  const xyz = format === 'float32x3' ? 'aPosition' : 'aPosition.xyz';

  const bit: ShaderBit = {
    name: `position:${format}`,
    attributes: {
      aPosition: format,
    },
    gpu: {
      vertex: {
        input: `position = vec4<f32>(vec3<f32>(input.${xyz}), 1.0);`,
      },
    },
    gl: {
      vertex: {
        input: `position = vec4(vec3(${xyz}), 1.0);`,
      },
    },
  };

  cache[format] = bit;
  return bit;
}
