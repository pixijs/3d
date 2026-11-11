/**
 * `GeometryAtlas.add`, timed in Node: what a geometry costs when it first enters the shared vertex and index buffers,
 * which an app pays once for every geometry it streams in. Each geometry is built from separate arrays through the
 * `Geometry3D` options, as the glTF loader and the primitives build theirs, so its attributes copy into the atlas's
 * interleaved layout one by one.
 *
 * A sample is one add. The atlas is sized to hold exactly the geometry, so each sample removes it first and the add
 * compacts an atlas with nothing live, which costs a few field writes. The snapshot hashes the atlas's whole vertex
 * and index data, so a copy that moves one byte changes it.
 */

import { Geometry3D, GeometryAtlas, PlaneGeometry, SphereGeometry } from '@pixi/3d';
import { cpu } from 'benchy';

import { mulberry32 } from './data/rng.ts';

/** Vertices in a streamed terrain chunk or a crowd member. */
const CHUNK_VERTICES = 20_000;

/** Vertices along each side of the glTF-shaped grid: 10k vertices, a mid-size model. */
const GRID_SIDE = 100;

/** FNV-1a over 32-bit words. */
function hashWords(words: Uint32Array, length: number, hash: number): number {
  for (let i = 0; i < length; i++) hash = Math.imul(hash ^ words[i], 0x0100_0193);
  return hash >>> 0;
}

/** An atlas sized to `geometry`, and a function that adds it again each call. */
function addRepeatedly(geometry: Geometry3D) {
  const indexCount = geometry.indexBuffer.data.length;
  const atlas = new GeometryAtlas({
    referenceGeometry: geometry,
    initialVertexCapacity: geometry.vertexCount,
    initialIndexCapacity: indexCount,
  });
  return {
    atlas,
    bench: () => {
      atlas.remove(geometry);
      return atlas.add(geometry).vertexCount;
    },
    snapshot: () => {
      const vertexData = atlas.geometry.attributes.aPosition.buffer.data;
      const vertexWords = new Uint32Array(vertexData.buffer, vertexData.byteOffset, vertexData.byteLength >> 2);
      const indexData = atlas.geometry.indexBuffer.data as Uint32Array;
      return hashWords(indexData, indexCount, hashWords(vertexWords, vertexWords.length, 0x811c_9dc5));
    },
  };
}

cpu('add 20k vertices: positions, normals, uvs, colors', function* () {
  const random = mulberry32(0x5eed_0a71);
  const n = CHUNK_VERTICES;
  const geometry = new Geometry3D({
    positions: new Float32Array(n * 3).map(() => random()),
    normals: new Float32Array(n * 3).fill(0.577),
    uvs: new Float32Array(n * 2),
    colors: new Float32Array(n * 4).fill(1),
    indices: new Uint32Array(n).map((_, i) => i),
  });
  const { atlas, bench, snapshot } = addRepeatedly(geometry);
  yield { bench, snapshot };
  atlas.destroy();
  geometry.destroy();
});

/**
 * A 100 by 100 vertex `PlaneGeometry` with tangents, so it carries what a glTF PBR mesh does: positions, normals,
 * uvs, and tangents with a handedness sign, with 16-bit indices. The normals and tangents quantize to `snorm16x4`, as
 * they do by default.
 */
cpu('add a 10k-vertex glTF-shaped mesh: positions, normals, uvs, tangents', function* () {
  const random = mulberry32(0x5eed_0a72);
  const n = GRID_SIDE * GRID_SIDE;
  const tangents = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) tangents.set([1, 0, 0, random() < 0.5 ? -1 : 1], i * 4);
  const geometry = new PlaneGeometry({ widthSegments: GRID_SIDE - 1, heightSegments: GRID_SIDE - 1, tangents });
  const { atlas, bench, snapshot } = addRepeatedly(geometry);
  yield { bench, snapshot };
  atlas.destroy();
  geometry.destroy();
});

/** A default `SphereGeometry`, 561 vertices: a small prop, where the per-attribute setup weighs most. */
cpu('add a 561-vertex sphere', function* () {
  const geometry = new SphereGeometry();
  const { atlas, bench, snapshot } = addRepeatedly(geometry);
  yield { bench, snapshot };
  atlas.destroy();
  geometry.destroy();
});
