/**
 * Streaming geometries into a `GeometryAtlas`, timed in Node: one geometry added a frame and the atlas brought up to
 * date after each, from an empty atlas, so the sample pays every growth on the way. The renderer is a fake GPU that
 * keeps each buffer's bytes in CPU arrays, so a write or a copy costs the memory traffic `writeBuffer` and
 * `copyBufferToBuffer` cost the CPU. The snapshot hashes the final vertex buffer as that fake GPU holds it.
 */

import { Geometry3D, GeometryAtlas, RetireSystem } from '@pixi/3d';
import { cpu } from 'benchy';
import type { Buffer } from 'pixi.js';

import { mulberry32 } from './data/rng.ts';

/** Geometries streamed in, each a crowd member or a prop's worth of vertices. */
const GEOMETRIES = 200;
const VERTICES = 2_000;

class FakeGpu {
  public readonly uid = 1;
  private readonly _memory = new Map<Buffer, Uint8Array>();
  private readonly _retireSystem = new RetireSystem();

  public bytes(buffer: Buffer): Uint8Array {
    let memory = this._memory.get(buffer);
    if (!memory) this._memory.set(buffer, (memory = new Uint8Array(buffer.descriptor.size)));
    return memory;
  }

  /** Stands in for `renderer.buffer` */
  public readonly buffer = {
    write: (buffer: Buffer, data: ArrayBufferView, offset: number): void => {
      this.bytes(buffer).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), offset);
    },
    copy: (from: Buffer, to: Buffer, size: number, fromOffset: number, toOffset: number): void => {
      this.bytes(to).set(this.bytes(from).subarray(fromOffset, fromOffset + size), toOffset);
    },
  };

  /** What the next render's `RetireSystem` does, and the GPU memory that frees */
  public releaseRetired(): void {
    this._retireSystem.prerender();
    for (const buffer of this._memory.keys()) if (buffer.destroyed) this._memory.delete(buffer);
  }
}

/** FNV-1a over 32-bit words. */
function hashWords(words: Uint32Array, hash: number): number {
  for (let i = 0; i < words.length; i++) hash = Math.imul(hash ^ words[i], 0x0100_0193);
  return hash >>> 0;
}

function makeGeometries(seed: number): Geometry3D[] {
  const random = mulberry32(seed);
  return Array.from(
    { length: GEOMETRIES },
    () =>
      new Geometry3D({
        positions: new Float32Array(VERTICES * 3).map(() => random()),
        normals: new Float32Array(VERTICES * 3).fill(0.577),
        uvs: new Float32Array(VERTICES * 2).map(() => random()),
        indices: new Uint32Array(VERTICES).map((_, i) => i),
      }),
  );
}

function* streamIn() {
  const geometries = makeGeometries(0x5eed_0a73);
  let atlas = null as GeometryAtlas | null;
  let gpu = new FakeGpu();

  yield {
    bench: () => {
      atlas?.destroy();
      atlas = new GeometryAtlas({ referenceGeometry: geometries[0] });
      gpu = new FakeGpu();
      for (const geometry of geometries) {
        atlas.add(geometry);
        atlas.update(gpu as never);
        gpu.releaseRetired();
      }
      return atlas.geometry.attributes.aPosition.buffer.descriptor.size;
    },
    snapshot: () => {
      const bytes = gpu.bytes(atlas!.geometry.attributes.aPosition.buffer);
      return hashWords(new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2), 0x811c_9dc5);
    },
  };

  atlas?.destroy();
  for (const geometry of geometries) geometry.destroy();
}

/**
 * An atlas holding 200 geometries swaps every other one out in one frame, then streams them back one a frame. The atlas
 * runs out of room partway and compacts, moving the geometries after each hole, and the renderer catches up after it.
 * @yields The timed sample and its snapshot
 */
function* swapHalf() {
  const geometries = makeGeometries(0x5eed_0a74);
  const atlas = new GeometryAtlas({ referenceGeometry: geometries[0] });
  const gpu = new FakeGpu();
  const frame = () => {
    atlas.update(gpu as never);
    gpu.releaseRetired();
  };
  for (const geometry of geometries) {
    atlas.add(geometry);
    frame();
  }

  yield {
    bench: () => {
      for (let i = 0; i < GEOMETRIES; i += 2) atlas.remove(geometries[i]);
      frame();
      for (let i = 0; i < GEOMETRIES; i += 2) {
        atlas.add(geometries[i]);
        frame();
      }
      return atlas.geometry.attributes.aPosition.buffer.descriptor.size;
    },
    snapshot: () => {
      const bytes = gpu.bytes(atlas.geometry.attributes.aPosition.buffer);
      return hashWords(new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2), 0x811c_9dc5);
    },
  };

  atlas.destroy();
  for (const geometry of geometries) geometry.destroy();
}

cpu('stream 200 geometries of 2k vertices into an atlas, one a frame', () => streamIn());

cpu('swap half of 200 geometries out and stream them back, one a frame', () => swapHalf());
