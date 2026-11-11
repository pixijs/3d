import type { InstanceDataStoreBuffer } from '../buffers/InstanceDataStoreBuffer';

/**
 * The instance data of a {@link BatchedMesh3D} as one float array, for rewriting many slots a frame
 *
 * Field `name` of slot `i` is the four numbers from `offset + i * stride + fields[name]`. Call
 * {@link BatchInstanceData.update | update} once you're done, or the writes may never be uploaded:
 *
 * ```ts
 * const { data, stride, offset, fields } = batched.instanceData;
 *
 * for (let i = 0, o = offset + fields.look; i < batched.size; i++, o += stride) {
 *   data[o + 3] = glow[i];
 * }
 *
 * batched.instanceData.update();
 * ```
 *
 * Write `vec4<u32>` and `vec4<i32>` fields through {@link BatchInstanceData.u32Data | u32Data}, which
 * views the same memory at the same indices. The matrices are a separate array,
 * {@link BatchedMesh3D.matrices}, with their own `stride` and `offset`, and `update()` here uploads
 * none of them. Read `stride`, `offset` and `fields` rather than hard-coding them, since the layout
 * can change between releases.
 * @category scene
 * @advanced
 */
export class BatchInstanceData {
  /** Floats from one slot's row to the next in {@link BatchInstanceData.data | data} */
  public readonly stride: number = 0;
  /** Float index of slot 0's row in {@link BatchInstanceData.data | data} */
  public readonly offset: number = 0;
  /** Each field's first float within a slot's row */
  public readonly fields: Readonly<Record<string, number>>;

  private readonly _store: InstanceDataStoreBuffer;
  private readonly _baseIndex: number = 0;
  private readonly _size: number = 0;

  /** @internal */
  constructor(store: InstanceDataStoreBuffer, baseIndex: number, size: number) {
    const { layout } = store;

    this._store = store;
    this._baseIndex = baseIndex;
    this._size = size;
    this.stride = layout.stride;
    this.offset = baseIndex * layout.stride;
    this.fields = layout.offsets;
  }

  /** The instance data as floats; it stays valid across `unload()`, but not past `destroy()` */
  public get data(): Float32Array {
    return this._store.data;
  }

  /**
   * The same memory as {@link BatchInstanceData.data | data}, as unsigned integers
   *
   * A negative number written here keeps its bits, so it reads back negative from a `vec4<i32>`
   * field.
   */
  public get u32Data(): Uint32Array {
    return this._store.u32Data;
  }

  /**
   * Uploads the instance data written in place on the next render
   *
   * Pass the range that changed to upload only those slots. Throws a `RangeError` for a range outside
   * the batch. Once it's called, every slot marked before the next render uploads as one span, from
   * the lowest to the highest, so for a few scattered slots use
   * {@link BatchedMesh3D.setInstanceDataAt | setInstanceDataAt} alone.
   * @param first - The first slot that changed
   * @param count - How many slots changed; defaults to every slot from `first` on
   */
  public update(first = 0, count = this._size - first): void {
    const size = this._size;
    if (!(first >= 0 && count >= 0 && first + count <= size)) {
      throw new RangeError(`update: slots ${first} to ${first + count - 1} are outside the batch (${size} slots).`);
    }
    if (count === 0) return;

    const base = this._baseIndex + first;
    this._store.markDirtyRange(base, base + count - 1);
  }

  /** @internal */
  public destroy(): void {
    (this._store as InstanceDataStoreBuffer | null) = null;
  }
}
