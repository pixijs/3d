import type { TypedArray } from 'pixi.js';

/**
 * Widens three-component vertex colours to RGBA with an opaque alpha
 *
 * glTF allows `COLOR_n` as VEC3 or VEC4, but `Geometry3D` reads colours four components per
 * vertex, so VEC3 data has to be widened first. Alpha is the component type's 1: `255` for
 * `Uint8Array`, `65535` for `Uint16Array`, `1` for `Float32Array`.
 * @param data - Source colour data
 * @param components - Components per vertex in `data`; anything but 3 returns `data` unchanged
 * @internal
 */
export function widenColorToRgba(data: TypedArray, components: number): TypedArray {
  if (components !== 3) return data;

  const Ctor = data.constructor as new (len: number) => TypedArray;
  const vertexCount = data.length / 3;
  const out = new Ctor(vertexCount * 4);
  const opaque = data instanceof Float32Array ? 1 : data instanceof Uint8Array ? 255 : 65535;

  for (let i = 0; i < vertexCount; i++) {
    const src = i * 3;
    const dst = i * 4;
    out[dst] = data[src];
    out[dst + 1] = data[src + 1];
    out[dst + 2] = data[src + 2];
    out[dst + 3] = opaque;
  }

  return out;
}
