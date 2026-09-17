import type { Mesh3DData } from './Mesh3DData';

/**
 * Lightweight per-pass sorted view into a shared mesh array
 *
 * Stores indices into the master mesh list + parallel sort keys.
 * Dense storage with swap-and-pop for O(1) add/remove.
 * After sort(), `indices` contains resolved master indices in sorted order,
 * so consumers read `items[indices[i]]` directly.
 * @internal
 */
export class SortedMesh3DView<T extends Mesh3DData> {
  /** Reference to the shared master mesh array, set once and never copied */
  public items: T[];

  /** Number of items in this pass view */
  public count = 0;

  /** Dirty flag — set on add/remove/updateKey, cleared by sort */
  public dirty = true;

  /**
   * Sorted output: master mesh indices in sort order
   * After sort(), `items[indices[i]]` gives the i-th item in sorted order.
   */
  public indices: Uint32Array;

  /** Dense map: local position -> master mesh index */
  public renderableIndices: Uint32Array;

  /** Parallel sort keys (Float64 for >32-bit integer support) */
  private _sortKeys: Float64Array;

  /** Temp array for sorting local indices by key */
  private _localIndices: Uint32Array;

  /** UID -> local index for O(1) removal */
  private _uidToLocal: Record<number, number> = Object.create(null);

  /**
   * @param items - Shared master mesh array.
   * @param initialCapacity - Pre-size all typed arrays to this capacity (avoids grow/copy cycles).
   *   One view exists per (batch, pass) and its four parallel arrays cost ~20 bytes a slot,
   *   so the default stays small — most views hold a handful of meshes, and anything that
   *   outgrows it jumps straight to the 256 grow floor, keeping copies rare either way.
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
   * Update the sort key for an item in O(1)
   *
   * An unchanged key can't change the order, so it doesn't dirty the view — dirtying
   * buys a comparator sort, a JS callback run ~n log n times. Materials get reassigned
   * to *equivalent* ones (same shader, state and texture sources) far more often than
   * to something that actually re-sorts.
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

  /** Sort and produce the `indices` array (master indices in sorted order) */
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
   * Sort with a forced key recalculation from the items
   *
   * Used by the transparent pass — distance-based keys change every frame.
   * @param getKey - Key extractor function.
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
   * Find the UID stored at a given local index via the items array
   * @param local - Index into this view's sorted order
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
