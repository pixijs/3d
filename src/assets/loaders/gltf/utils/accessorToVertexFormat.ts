import type { VertexFormat } from 'pixi.js';

import type { Accessor } from '../GltfFormat';

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

/**
 * For each glTF `componentType`, the WebGPU `VertexFormat` prefix emitted for raw vs. normalized accessors
 *
 * Float ignores the `normalized` flag (always `float32`); integer types pick
 * `(s|u)int*` raw or `(s|u)norm*` normalized.
 */
const COMPONENT_TYPE_TO_PREFIX: Record<number, { raw: string; normalized: string }> = {
  [GL_FLOAT]: { raw: 'float32', normalized: 'float32' },
  [GL_BYTE]: { raw: 'sint8', normalized: 'snorm8' },
  [GL_UNSIGNED_BYTE]: { raw: 'uint8', normalized: 'unorm8' },
  [GL_SHORT]: { raw: 'sint16', normalized: 'snorm16' },
  [GL_UNSIGNED_SHORT]: { raw: 'uint16', normalized: 'unorm16' },
};

/**
 * Maps a glTF `Accessor` (`componentType`, `type`, `normalized`) to a WebGPU `VertexFormat` string
 *
 * VEC3 integer/normalized variants map to `x4` because WebGPU has no `x3`
 * formats for those types — callers must pad the data to 4 components.
 * VEC3 floats keep `x3` (WebGPU has `float32x3`).
 * @param accessor - The accessor describing the attribute's element layout
 * @internal
 */
export function accessorToVertexFormat(accessor: Accessor): VertexFormat {
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
