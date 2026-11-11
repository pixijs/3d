import { MeshoptEncoder } from 'meshoptimizer';
import { Loader } from 'pixi.js';
import type { ResolvedAsset } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { loadGlb } from '~/assets/loaders/gltf/loadGlb';
import type { Scene3DSource } from '~/assets/Scene3DSource';

import { packGlb } from './gltfFixtures';

const POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

async function meshoptGlb(): Promise<Blob> {
  await MeshoptEncoder.ready;

  const stride = 12;
  const count = POSITIONS.length / 3;
  const compressed = MeshoptEncoder.encodeVertexBuffer(new Uint8Array(POSITIONS.buffer), count, stride);

  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['EXT_meshopt_compression'],
    extensionsRequired: ['EXT_meshopt_compression'],
    buffers: [
      { byteLength: compressed.byteLength },
      { byteLength: count * stride, extensions: { EXT_meshopt_compression: { fallback: true } } },
    ],
    bufferViews: [
      {
        buffer: 1,
        byteOffset: 0,
        byteLength: count * stride,
        byteStride: stride,
        target: 34962,
        extensions: {
          EXT_meshopt_compression: {
            buffer: 0,
            byteOffset: 0,
            byteLength: compressed.byteLength,
            byteStride: stride,
            mode: 'ATTRIBUTES',
            count,
          },
        },
      },
    ],
    accessors: [{ bufferView: 0, componentType: 5126, count, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ name: 'triangle', mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };

  return packGlb(json, compressed);
}

describe('EXT_meshopt_compression in GLB', () => {
  it('decodes compressed bufferViews packed in a .glb container', async () => {
    const url = URL.createObjectURL(await meshoptGlb());

    try {
      const source: Scene3DSource = await loadGlb.load(url, {} as ResolvedAsset, new Loader());
      const positions = source.geometries[0][0].positions;

      expect(Array.from(positions)).toEqual(Array.from(POSITIONS));
    } finally {
      URL.revokeObjectURL(url);
    }
  }, 30000);
});
