import { describe, expect, it } from 'vitest';

import type { GltfFormat } from '~/assets/loaders/gltf/GltfFormat';
import { getBuffer } from '~/assets/loaders/gltf/utils/getBuffer';

const F32 = 5126;
const U16 = 5123;

describe('getBuffer — sparse accessors', () => {
  it('replaces vertices 1 and 3 of a four-vertex accessor with no bufferView, whose base is zeros', () => {
    const indices = new Uint16Array([1, 3]);
    const values = new Float32Array([10, 20, 30, 40, 50, 60]);
    const buffers = [indices.buffer, values.buffer];
    const gltf = {
      accessors: [
        {
          componentType: F32,
          type: 'VEC3',
          count: 4,
          sparse: {
            count: 2,
            indices: { bufferView: 0, componentType: U16 },
            values: { bufferView: 1 },
          },
        },
      ],
      bufferViews: [{ buffer: 0 }, { buffer: 1 }],
    } as unknown as GltfFormat;

    const out = getBuffer(gltf, buffers, 0);
    expect(Array.from(out as Float32Array)).toEqual([0, 0, 0, 10, 20, 30, 0, 0, 0, 40, 50, 60]);
  });

  it('replaces vertex 1 of a base read from a bufferView', () => {
    const base = new Float32Array([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    const indices = new Uint16Array([1]);
    const values = new Float32Array([9, 9, 9]);
    const buffers = [base.buffer, indices.buffer, values.buffer];
    const gltf = {
      accessors: [
        {
          bufferView: 0,
          componentType: F32,
          type: 'VEC3',
          count: 3,
          sparse: {
            count: 1,
            indices: { bufferView: 1, componentType: U16 },
            values: { bufferView: 2 },
          },
        },
      ],
      bufferViews: [{ buffer: 0 }, { buffer: 1 }, { buffer: 2 }],
    } as unknown as GltfFormat;

    const out = getBuffer(gltf, buffers, 0);
    expect(Array.from(out as Float32Array)).toEqual([1, 1, 1, 9, 9, 9, 3, 3, 3]);
  });

  it('decodes a VEC2 accessor, which skips the unrolled VEC3 copy', () => {
    const indices = new Uint16Array([0, 2]);
    const values = new Float32Array([1, 2, 3, 4]);
    const buffers = [indices.buffer, values.buffer];
    const gltf = {
      accessors: [
        {
          componentType: F32,
          type: 'VEC2',
          count: 4,
          sparse: {
            count: 2,
            indices: { bufferView: 0, componentType: U16 },
            values: { bufferView: 1 },
          },
        },
      ],
      bufferViews: [{ buffer: 0 }, { buffer: 1 }],
    } as unknown as GltfFormat;

    const out = getBuffer(gltf, buffers, 0);
    expect(Array.from(out as Float32Array)).toEqual([1, 2, 0, 0, 3, 4, 0, 0]);
  });
});
