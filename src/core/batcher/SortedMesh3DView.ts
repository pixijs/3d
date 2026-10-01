import type { Mesh3DData } from './Mesh3DData';

/**
 * One pass's sorted view of a batch's items
 *
 * Holds indices into the shared item array with a sort key each, packed densely so add and remove
 * are O(1), remove by swapping in the last entry. After `sort()`, `items[indices[i]]` is the i-th
 * item in draw order.
 * @internal
 */
export class SortedMesh3DView<T extends Mesh3DData> {
  /** The batch's item array, shared with its other views and never copied */
  public items: T[];

  /** Number of items in this pass view */
  public count = 0;

  /** Whether `indices` is out of date: set by `add`, `remove`, a changed key and `clear`, cleared by a sort */
  public dirty = true;

  /** Item indices in draw order, as of the last sort */
  public indices: Uint32Array;

  /**
   * Item indices in insertion order, with removals swapped out
   *
   * Stays current through every `add()` and `remove()`, while `indices` only changes in a sort. A
   * walk that needs no order and runs before the pass sorts reads this array.
   */
  public renderableIndices: Uint32Array;

  /** Sort key of each `renderableIndices` entry; Float64 so a 53-bit key stays exact */
  private _sortKeys: Float64Array;

  /** Scratch for sorting positions by key */
  private _localIndices: Uint32Array;

  /** Each item's position in `renderableIndices` by uid, or -1 once removed */
  private _uidToLocal: Record<number, number> = Object.create(null);

  /**
   * @param items - The batch's item array.
   * @param initialCapacity - Entries the arrays start with. There is one view per batch and pass,
   *   at 20 bytes an entry, so the default is small: most views hold a few meshes, and a view that
   *   outgrows it jumps straight to 256 entries.
   */
  constructor(items: T[], initialCapacity = 32) {
    this.items = items;
    this.renderableIndices = new Uint32Array(initialCapacity);
    this._sortKeys = new Float64Array(initialCapacity);
    this._localIndices = new Uint32Array(initialCapacity);
    this.indices = new Uint32Array(initialCapacity);
  }

  /**
   * Add an item to this pass view
   * @param uid - The item's UID.
   * @param renderableIndex - Index into the shared mesh array.
   * @param sortKey - Initial sort key.
   */
  public add(uid: number, renderableIndex: number, sortKey: number): void {
    const local = this.count++;

    if (local >= this.renderableIndices.length) {
      this._grow(Math.max(this.renderableIndices.length * 2, 256));
    }

    this.renderableIndices[local] = renderableIndex;
    this._sortKeys[local] = sortKey;
    this._uidToLocal[uid] = local;
    this.dirty = true;
  }

  /**
   * Remove an item from this pass view in O(1) via swap-and-pop
   * @param uid - The item's UID.
   */
  public remove(uid: number): void {
    const local = this._uidToLocal[uid];

    if (local === undefined || local < 0) return;

    const lastLocal = --this.count;

    if (local !== lastLocal) {
      const lastRenderableIdx = this.renderableIndices[lastLocal];
      const lastKey = this._sortKeys[lastLocal];
      const lastUid = this._getUidAtLocal(lastLocal);

      this.renderableIndices[local] = lastRenderableIdx;
      this._sortKeys[local] = lastKey;
      this._uidToLocal[lastUid] = local;
    }

    this._uidToLocal[uid] = -1;
    this.dirty = true;
  }

  /**
   * Updates an item's sort key in O(1)
   *
   * An unchanged key leaves the view clean, since a dirty view costs a comparator sort, a JS
   * callback run about n log n times. A material swapped for an equivalent one, with the same
   * shader, state and texture sources, re-keys to the same value, and that is far more common than
   * a swap that re-sorts.
   * @param uid - The item's UID
   * @param key - The new sort key
   */
  public updateKey(uid: number, key: number): void {
    const local = this._uidToLocal[uid];
    if (local === undefined || local < 0) return;
    if (this._sortKeys[local] === key) return;
    this._sortKeys[local] = key;
    this.dirty = true;
  }

  /** Sorts by key into `indices`, if anything changed since the last sort */
  public sort(): void {
    const count = this.count;
    if (count === 0) return;
    if (!this.dirty) return;

    const keys = this._sortKeys;
    const localIndices = this._localIndices;
    const renderableIndices = this.renderableIndices;
    const indices = this.indices;

    for (let i = 0; i < count; i++) {
      localIndices[i] = i;
    }

    localIndices.subarray(0, count).sort((a, b) => keys[a] - keys[b]);

    for (let i = 0; i < count; i++) {
      indices[i] = renderableIndices[localIndices[i]];
    }

    this.dirty = false;
  }

  /**
   * Re-reads every key from its item and sorts, whether or not the view is dirty
   *
   * For the transparent pass, whose distance keys change every frame.
   * @param getKey - Reads an item's key.
   */
  public sortForced(getKey: (item: T) => number): void {
    const count = this.count;
    if (count === 0) return;

    const items = this.items;
    const keys = this._sortKeys;
    const renderableIndices = this.renderableIndices;
    const localIndices = this._localIndices;
    const indices = this.indices;

    for (let i = 0; i < count; i++) {
      localIndices[i] = i;
      keys[i] = getKey(items[renderableIndices[i]]);
    }

    localIndices.subarray(0, count).sort((a, b) => keys[a] - keys[b]);

    for (let i = 0; i < count; i++) {
      indices[i] = renderableIndices[localIndices[i]];
    }

    this.dirty = false;
  }

  /** Empty the view, keeping allocated capacity */
  public clear(): void {
    this.count = 0;
    this._uidToLocal = Object.create(null);
    this.dirty = true;
  }

  /**
   * The uid of the item at a position in `renderableIndices`
   * @param local - Position in `renderableIndices`, not in sorted order
   */
  private _getUidAtLocal(local: number): number {
    const renderableIdx = this.renderableIndices[local];
    return this.items[renderableIdx].uid;
  }

  private _grow(newCapacity: number): void {
    const oldRI = this.renderableIndices;
    const oldKeys = this._sortKeys;

    this.renderableIndices = new Uint32Array(newCapacity);
    this._sortKeys = new Float64Array(newCapacity);
    this._localIndices = new Uint32Array(newCapacity);
    this.indices = new Uint32Array(newCapacity);

    this.renderableIndices.set(oldRI);
    this._sortKeys.set(oldKeys);
  }
}
