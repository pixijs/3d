import { MeshoptEncoder } from 'meshoptimizer';
import type { Loader, ResolvedAsset } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { loadGlb } from '~/assets/loaders/gltf/loadGlb';
import type { Scene3DSource } from '~/assets/Scene3DSource';

const POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

/**
 * Builds a GLB shaped like gltfpack's output: the BIN chunk holds the meshopt-compressed
 * vertex bytes, and the bufferView points at a URI-less fallback buffer that carries no data.
 */
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

/** Assembles a binary glTF container: 12-byte header, JSON chunk, BIN chunk. */
function packGlb(json: unknown, bin: Uint8Array): Blob {
  const jsonChunk = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const binChunk = pad(bin, 0);
  const length = 12 + 8 + jsonChunk.byteLength + 8 + binChunk.byteLength;

  const header = new ArrayBuffer(12 + 8);
  const view = new DataView(header);

  view.setUint32(0, 0x46546c67, true); // 'glTF'
  view.setUint32(4, 2, true);
  view.setUint32(8, length, true);
  view.setUint32(12, jsonChunk.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true); // 'JSON'

  const binHeader = new ArrayBuffer(8);
  const binView = new DataView(binHeader);

  binView.setUint32(0, binChunk.byteLength, true);
  binView.setUint32(4, 0x004e4942, true); // 'BIN'

  return new Blob([header, jsonChunk, binHeader, binChunk]);
}

/** GLB chunks are 4-byte aligned; JSON pads with spaces, BIN with zeroes. */
function pad(bytes: Uint8Array, fill: number): Uint8Array<ArrayBuffer> {
  const padded = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4).fill(fill);

  padded.set(bytes);

  return padded;
}

describe('EXT_meshopt_compression in GLB', () => {
  it('decodes compressed bufferViews packed in a .glb container', async () => {
    const url = URL.createObjectURL(await meshoptGlb());

    try {
      const source: Scene3DSource = await loadGlb.load(url, {} as ResolvedAsset, {} as Loader);
      const positions = source.geometries[0][0].positions;

      expect(Array.from(positions)).toEqual(Array.from(POSITIONS));
    } finally {
      URL.revokeObjectURL(url);
    }
  }, 30000);
});
