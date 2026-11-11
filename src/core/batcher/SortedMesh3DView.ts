import type { Mesh3DData } from './Mesh3DData';

/** Change flag: the item's entry in the last order is stale, since it left or re-keyed */
const REMOVED = 1;

/** Change flag: the item needs a place in the next order, since it arrived or re-keyed */
const PENDING = 2;

const INSERTION_SHIFT_BUDGET = 32;

const MAX_INSERTION_BACKOFF = 64;

/**
 * One pass's sorted view of a batch's items: after a sort, `items[indices[i]]` is the i-th in draw order
 *
 * Both sorts start from the last order, so a frame with few changes costs close to one pass over it.
 * @internal
 */
export class SortedMesh3DView<T extends Mesh3DData> {
  /** The batch's item array, shared with its other views, so never copied */
  public items: T[];

  public count = 0;

  /** Whether `indices` needs a sort */
  public dirty = true;

  /**
   * Bumped when a sort may have changed the order; the insertion sort in `sortForced` bumps it only
   * when an entry moved, since each bump rebuilds a distance-sorted pass's draws
   */
  public orderDirtyId = 0;

  public indices: Uint32Array;

  /** Item indices in add order, each removal filled by the last entry; current between sorts, unlike `indices` */
  public renderableIndices: Uint32Array;

  /** Float64, so a 53-bit key stays exact */
  private _sortKeys: Float64Array;

  private _localIndices: Uint32Array;

  private readonly _uidToLocal = new Map<number, number>();

  /** Entries of `indices` the last sort left in order, or -1 when there's no order to start from */
  private _sortedCount = -1;

  private _sortedKeys: Float64Array;

  private _mergeIndices: Uint32Array;

  private _mergeKeys: Float64Array;

  private _changes = new Uint8Array(0);

  private _hasChanges = false;

  /**
   * Uids flagged {@link PENDING} since the last sort, the first `_pendingCount` of them; counted rather
   * than truncated, so it keeps its storage
   */
  private readonly _pending: number[] = [];

  private _pendingCount = 0;

  private _orderForced = false;

  private _insertionSkip = 0;

  private _insertionBackoff = 0;

  constructor(items: T[], initialCapacity = 32) {
    this.items = items;
    this.renderableIndices = new Uint32Array(initialCapacity);
    this._sortKeys = new Float64Array(initialCapacity);
    this._localIndices = new Uint32Array(initialCapacity);
    this.indices = new Uint32Array(initialCapacity);
    this._sortedKeys = new Float64Array(initialCapacity);
    this._mergeIndices = new Uint32Array(initialCapacity);
    this._mergeKeys = new Float64Array(initialCapacity);
  }

  /** Whether the last order came from `sortForced`, so it holds no key order to merge into or keep commands against */
  public get orderForced(): boolean {
    return this._orderForced;
  }

  /** The item index of a member, or -1 when the view doesn't hold it */
  public indexOf(uid: number): number {
    const local = this._uidToLocal.get(uid);

    return local === undefined ? -1 : this.renderableIndices[local];
  }

  public add(uid: number, renderableIndex: number, sortKey: number): void {
    const local = this.count++;

    if (local >= this.renderableIndices.length) {
      this._grow(Math.max(this.renderableIndices.length * 2, 256));
    }

    this.renderableIndices[local] = renderableIndex;
    this._sortKeys[local] = sortKey;
    this._uidToLocal.set(uid, local);
    this.dirty = true;

    if (this._sortedCount >= 0) this._markPending(uid, renderableIndex);
  }

  public remove(uid: number): void {
    const local = this._uidToLocal.get(uid);

    if (local === undefined) return;

    const renderableIndex = this.renderableIndices[local];
    const lastLocal = --this.count;

    if (local !== lastLocal) {
      const lastRenderableIdx = this.renderableIndices[lastLocal];
      const lastKey = this._sortKeys[lastLocal];
      const lastUid = this._getUidAtLocal(lastLocal);

      this.renderableIndices[local] = lastRenderableIdx;
      this._sortKeys[local] = lastKey;
      this._uidToLocal.set(lastUid, local);
    }

    this._uidToLocal.delete(uid);
    this.dirty = true;

    if (this._sortedCount >= 0) {
      this._setChange(renderableIndex, REMOVED);
      this._changes[renderableIndex] &= ~PENDING;
    }
  }

  /** Updates an item's sort key, leaving the view clean when the key is unchanged, as it is after most material swaps */
  public updateKey(uid: number, key: number): void {
    const local = this._uidToLocal.get(uid);
    if (local === undefined) return;
    if (this._sortKeys[local] === key) return;
    this._sortKeys[local] = key;
    this.dirty = true;

    if (this._sortedCount >= 0) {
      const renderableIndex = this.renderableIndices[local];
      this._setChange(renderableIndex, REMOVED);
      this._markPending(uid, renderableIndex);
    }
  }

  /** Sorts by key into `indices` if anything changed, patching the last order when few items moved */
  public sort(): void {
    const count = this.count;
    if (count === 0) {
      this._resetOrder(0);
      return;
    }
    if (!this.dirty) return;

    if (this._sortedCount < 0 || this._orderForced || this._pendingCount > count >> 1 || !this._patchOrder()) {
      this._sortFull();
    }
    this.orderDirtyId++;

    this._orderForced = false;
    this.dirty = false;
  }

  /**
   * Re-reads every key and sorts, dirty or not, trying an insertion sort of the last order first while the items are
   * unchanged; it backs off after a failure, since a view two cameras take turns sorting fails it every time
   */
  public sortForced(getKey: (item: T) => number): void {
    const count = this.count;
    if (count === 0) {
      this._resetOrder(0);
      this.orderDirtyId++;
      return;
    }

    let sorted = false;
    if (this._orderForced && this._sortedCount === count && !this._hasChanges) {
      if (this._insertionSkip > 0) this._insertionSkip--;
      else sorted = this._insertionSort(getKey);
    }

    if (!sorted) {
      const items = this.items;
      const keys = this._sortKeys;
      const renderableIndices = this.renderableIndices;

      for (let i = 0; i < count; i++) {
        keys[i] = getKey(items[renderableIndices[i]]);
      }

      this._sortFull();
    }

    this._orderForced = true;
    this.dirty = false;
  }

  public clear(): void {
    this.orderDirtyId++;
    this.count = 0;
    this._uidToLocal.clear();
    this.dirty = true;
    this._resetOrder(-1);
    this._orderForced = false;
    this._insertionSkip = 0;
    this._insertionBackoff = 0;
  }

  private _sortFull(): void {
    const count = this.count;
    const keys = this._sortKeys;
    const localIndices = this._localIndices;
    const renderableIndices = this.renderableIndices;
    const indices = this.indices;
    const sortedKeys = this._sortedKeys;

    for (let i = 0; i < count; i++) {
      localIndices[i] = i;
    }

    localIndices.subarray(0, count).sort((a, b) => keys[a] - keys[b]);

    for (let i = 0; i < count; i++) {
      const local = localIndices[i];
      indices[i] = renderableIndices[local];
      sortedKeys[i] = keys[local];
    }
    this.orderDirtyId++;

    this._resetOrder(count);
  }

  /**
   * Re-sorts the last order by fresh keys with an insertion sort
   * @returns `false` when it ran out of budget, so the caller sorts in full
   */
  private _insertionSort(getKey: (item: T) => number): boolean {
    const count = this.count;
    const items = this.items;
    const indices = this.indices;
    const keys = this._sortedKeys;

    for (let i = 0; i < count; i++) {
      keys[i] = getKey(items[indices[i]]);
    }

    const budget = count * INSERTION_SHIFT_BUDGET;
    let shifts = 0;

    for (let i = 1; i < count; i++) {
      const key = keys[i];
      if (keys[i - 1] <= key) continue;

      const index = indices[i];
      let j = i - 1;
      do {
        keys[j + 1] = keys[j];
        indices[j + 1] = indices[j];
        j--;
      } while (j >= 0 && keys[j] > key);
      keys[j + 1] = key;
      indices[j + 1] = index;

      shifts += i - 1 - j;
      if (shifts > budget) {
        this._insertionBackoff = Math.min(MAX_INSERTION_BACKOFF, Math.max(1, this._insertionBackoff * 2));
        this._insertionSkip = this._insertionBackoff;
        return false;
      }
    }

    this._insertionBackoff = 0;
    if (shifts > 0) this.orderDirtyId++;
    return true;
  }

  /**
   * Merges the sorted pending items into the last order; equal keys keep the last order, newcomers after
   * @returns `false` when the patched order doesn't account for every item, so the caller sorts in full
   */
  private _patchOrder(): boolean {
    const count = this.count;
    const keys = this._sortKeys;
    const renderableIndices = this.renderableIndices;
    if (this._changes.length < this.items.length) this._growChanges(this.items.length);
    const changes = this._changes;

    const arriving = this._localIndices;
    let arrivingCount = 0;
    for (let p = 0; p < this._pendingCount; p++) {
      const local = this._uidToLocal.get(this._pending[p]);
      if (local === undefined) continue;
      const renderableIndex = renderableIndices[local];
      if ((changes[renderableIndex] & PENDING) === 0) continue;
      changes[renderableIndex] &= ~PENDING;
      arriving[arrivingCount++] = local;
    }
    if (arrivingCount > 1) arriving.subarray(0, arrivingCount).sort((a, b) => keys[a] - keys[b]);

    const previous = this.indices;
    const previousKeys = this._sortedKeys;
    const previousCount = this._sortedCount;
    const merged = this._mergeIndices;
    const mergedKeys = this._mergeKeys;
    let i = 0;
    let j = 0;
    let o = 0;

    for (;;) {
      while (i < previousCount && (changes[previous[i]] & REMOVED) !== 0) i++;
      if (i < previousCount && (j === arrivingCount || previousKeys[i] <= keys[arriving[j]])) {
        merged[o] = previous[i];
        mergedKeys[o++] = previousKeys[i++];
      } else if (j < arrivingCount) {
        const local = arriving[j++];
        merged[o] = renderableIndices[local];
        mergedKeys[o++] = keys[local];
      } else break;
    }
    if (o !== count) return false;

    this.indices = merged;
    this._mergeIndices = previous;
    this._sortedKeys = mergedKeys;
    this._mergeKeys = previousKeys;
    this._resetOrder(count);
    return true;
  }

  /**
   * Flags an item for a place in the next order, dropping the order once the pending list outgrows
   * the view, so a view that never sorts doesn't grow it forever
   */
  private _markPending(uid: number, renderableIndex: number): void {
    if (!this._setChange(renderableIndex, PENDING)) return;
    this._pending[this._pendingCount++] = uid;
    if (this._pendingCount > this.renderableIndices.length) this._resetOrder(-1);
  }

  /** Sets a change flag on an item index; returns whether it was newly set */
  private _setChange(renderableIndex: number, flag: number): boolean {
    if (renderableIndex >= this._changes.length) this._growChanges(renderableIndex + 1);
    const changes = this._changes;
    const flags = changes[renderableIndex];
    if ((flags & flag) !== 0) return false;
    changes[renderableIndex] = flags | flag;
    this._hasChanges = true;
    return true;
  }

  /** Grows `_changes`; a patch grows it to the item array's length first, since the merge reading past its end is slow */
  private _growChanges(minLength: number): void {
    const grown = new Uint8Array(Math.max(minLength, this._changes.length * 2, 256));
    grown.set(this._changes);
    this._changes = grown;
  }

  private _resetOrder(sortedCount: number): void {
    if (this._hasChanges) {
      this._changes.fill(0);
      this._hasChanges = false;
      this._pendingCount = 0;
    }
    this._sortedCount = sortedCount;
  }

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
    this._sortedKeys = new Float64Array(newCapacity);
    this._mergeIndices = new Uint32Array(newCapacity);
    this._mergeKeys = new Float64Array(newCapacity);

    this.renderableIndices.set(oldRI);
    this._sortKeys.set(oldKeys);

    this._resetOrder(-1);
  }
}
