import { BufferResource, BufferUsage } from 'pixi.js';

import type { Mesh3DData } from '../batcher/Mesh3DData';
import type { SortedMesh3DView } from '../batcher/SortedMesh3DView';
import { Buffer3D } from './Buffer3D';

/** @internal */
export class RenderInstanceBuffer {
  public readonly bufferResource: BufferResource;
  private readonly _buffer: Buffer3D;

  /** One mesh store index per instance, in draw order */
  public data: Uint32Array;

  constructor(label: string, initialInstances = 128) {
    this.data = new Uint32Array(initialInstances);

    this._buffer = new Buffer3D({
      data: this.data,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label,
      shrinkToFit: false,
    });

    this.bufferResource = new BufferResource({ buffer: this._buffer });
  }

  public get buffer(): Buffer3D {
    return this._buffer;
  }

  /**
   * Growth drops the contents, since `populateIds` rewrites every record and a draw list's edit copies
   * the ones it keeps
   */
  public ensureSize(count: number): Uint32Array {
    if (this.data.length < count) {
      this.data = new Uint32Array(Math.ceil(count * 1.5));
      this._buffer.data = this.data;
    }
    return this.data;
  }

  public populateIds(view: SortedMesh3DView<Mesh3DData>): void {
    const count = view.count;
    const data = this.ensureSize(count);
    const sortedIndices = view.indices;
    const items = view.items;

    for (let i = 0; i < count; i++) {
      data[i] = items[sortedIndices[i]]._storeIndex;
    }
  }

  public upload(count: number, first = 0): void {
    this._buffer.update((count - first) * 4, first * 4);
  }

  public unload(): void {
    this._buffer?.unload();
  }

  public destroy(): void {
    if (!this._buffer) return;

    this.bufferResource.destroy(false);
    this._buffer.destroy();

    (this._buffer as Buffer3D | null) = null;
    (this.bufferResource as BufferResource | null) = null;
    (this.data as Uint32Array | null) = null;
  }
}
