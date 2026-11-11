import type { TypedArray } from 'pixi.js';

/**
 * Widens VEC3 colours to RGBA with an opaque alpha, as `Geometry3D` reads four per vertex
 * @param data - Colour data
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
