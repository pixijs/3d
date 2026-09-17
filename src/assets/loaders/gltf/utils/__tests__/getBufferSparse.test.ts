import { describe, expect, it } from 'vitest';

import type { GltfFormat } from '~/assets/loaders/gltf/GltfFormat';
import { getBuffer } from '~/assets/loaders/gltf/utils/getBuffer';

/**
 * Sparse accessors — common for morph targets, where only a few vertices move —
 * must decode to a dense packed array: a base (bufferView values, or zeros when
 * absent) with `sparse.count` entries displaced at `sparse.indices`.
 */

const F32 = 5126;
const U16 = 5123;

describe('getBuffer — sparse accessors', () => {
  it('displaces a zero base (the no-bufferView morph form)', () => {
    // 4-vertex VEC3 target, no base → zeros; displace vertices 1 and 3.
    const buffers = [
      new Uint16Array([1, 3]).buffer, // indices
      new Float32Array([10, 20, 30, 40, 50, 60]).buffer, // values for v1, v3
    ];
    const gltf = {
      accessors: [
        {
          componentType: F32,
          type: 'VEC3',
          count: 4,
          // no bufferView — base is all zeros
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

  it('displaces over a dense base', () => {
    // 3-vertex VEC3 base [1,1,1, 2,2,2, 3,3,3]; displace vertex 1 → [9,9,9].
    const buffers = [
      new Float32Array([1, 1, 1, 2, 2, 2, 3, 3, 3]).buffer, // base
      new Uint16Array([1]).buffer, // indices
      new Float32Array([9, 9, 9]).buffer, // values
    ];
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

  it('honours bufferView + accessor byteOffsets on the sparse streams', () => {
    // Values/indices packed after some padding, exercised via byteOffset.
    const idx = new Uint16Array([0, 2]); // 4 bytes
    const val = new Float32Array([7, 7, 7, 8, 8, 8]);
    const buffers = [idx.buffer, val.buffer];
    const gltf = {
      accessors: [
        {
          componentType: F32,
          type: 'VEC3',
          count: 3,
          sparse: {
            count: 2,
            indices: { bufferView: 0, byteOffset: 0, componentType: U16 },
            values: { bufferView: 1, byteOffset: 0 },
          },
        },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0 },
        { buffer: 1, byteOffset: 0 },
      ],
    } as unknown as GltfFormat;

    const out = getBuffer(gltf, buffers, 0);
    expect(Array.from(out as Float32Array)).toEqual([7, 7, 7, 0, 0, 0, 8, 8, 8]);
  });

  it('decodes non-VEC3 component counts via the generic path', () => {
    // VEC2, 4 elements, displace elements 0 and 2 — exercises the else branch
    // (the VEC3 scatter is unrolled; everything else uses the count-loop).
    const buffers = [
      new Uint16Array([0, 2]).buffer, // indices
      new Float32Array([1, 2, 3, 4]).buffer, // values for e0, e2
    ];
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
