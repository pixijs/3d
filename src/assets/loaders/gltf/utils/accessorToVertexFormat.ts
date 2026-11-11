import type { VertexFormat } from 'pixi.js';

import type { GltfFormat } from '../GltfFormat';

const GL_BYTE = 5120;
const GL_UNSIGNED_BYTE = 5121;
const GL_SHORT = 5122;
const GL_UNSIGNED_SHORT = 5123;
const GL_FLOAT = 5126;

const TYPE_TO_COMPONENTS: Record<string, 1 | 2 | 3 | 4> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
};

const COMPONENT_TYPE_TO_PREFIX: Record<number, { raw: string; normalized: string }> = {
  [GL_FLOAT]: { raw: 'float32', normalized: 'float32' },
  [GL_BYTE]: { raw: 'sint8', normalized: 'snorm8' },
  [GL_UNSIGNED_BYTE]: { raw: 'uint8', normalized: 'unorm8' },
  [GL_SHORT]: { raw: 'sint16', normalized: 'snorm16' },
  [GL_UNSIGNED_SHORT]: { raw: 'uint16', normalized: 'unorm16' },
};

/** @internal */
export const NORMALIZED_SCALE: Record<number, number> = {
  [GL_BYTE]: 1 / 127,
  [GL_UNSIGNED_BYTE]: 1 / 255,
  [GL_SHORT]: 1 / 32767,
  [GL_UNSIGNED_SHORT]: 1 / 65535,
};

/**
 * Maps an integer VEC3 to `x4`, as WebGPU has no 3-component 8- or 16-bit format, so
 * `accessorToAttribute` in `processMeshes.ts` pads the data
 * @internal
 */
export function accessorToVertexFormat(accessor: GltfFormat.Accessor): VertexFormat {
  const components = TYPE_TO_COMPONENTS[accessor.type];
  if (!components || components === 1) {
    throw new Error(`[accessorToVertexFormat] Unsupported accessor type: ${accessor.type}`);
  }

  const prefix = COMPONENT_TYPE_TO_PREFIX[accessor.componentType];
  if (!prefix) {
    throw new Error(`[accessorToVertexFormat] Unsupported componentType: ${accessor.componentType}`);
  }

  const isFloat = accessor.componentType === GL_FLOAT;
  const suffix = components === 3 ? (isFloat ? 'x3' : 'x4') : `x${components}`;
  const stem = accessor.normalized ? prefix.normalized : prefix.raw;

  return `${stem}${suffix}` as VertexFormat;
}
