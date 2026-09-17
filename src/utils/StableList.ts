/**
 * Minimal shape required by {@link StableList} — a unique numeric `uid`
 * @internal
 */
interface HasUid {
  /** Unique numeric id used as the O(1) lookup key */
  uid: number;
}

/**
 * A generic stable-index list backed by a free-list
 *
 * Items keep their index for their entire lifetime — removing an item
 * leaves a null hole that gets reused on the next add. No swap-and-pop,
 * no index invalidation.
 *
 * Uses a Uint32Array free-list stack with auto-grow for zero GC pressure.
 * @internal
 */
export class StableList<T extends HasUid> {
  /** Backing array. Holes are null after removal */
  public readonly items: (T | null)[] = [];

  /** High-water mark — total allocated slots (including holes) */
  public count = 0;

  private _freeList: Uint32Array = new Uint32Array(1024);
  private _freeCount = 0;
  private _uidToIndex: Record<number, number> = Object.create(null);

  /**
   * Allocates a stable slot for `item`
   * @param item - the item to store
   */
  public add(item: T): void {
    let index: number;

    if (this._freeCount > 0) {
      index = this._freeList[--this._freeCount];
    } else {
      index = this.count++;
    }

    this.items[index] = item;
    this._uidToIndex[item.uid] = index;
  }

  /**
   * Frees the slot occupied by `item`; the index becomes reusable
   * @param item - the item to remove
   */
  public remove(item: T): void {
    const index = this._uidToIndex[item.uid];
    if (index === undefined || index < 0) return;

    this.items[index] = null;
    this._uidToIndex[item.uid] = -1;

    if (this._freeCount >= this._freeList.length) {
      const bigger = new Uint32Array(this._freeList.length * 2);
      bigger.set(this._freeList);
      this._freeList = bigger;
    }

    this._freeList[this._freeCount++] = index;
  }

  /**
   * O(1) UID lookup
   * @param item - the item to look up
   * @returns The stable index, or -1 if not present.
   */
  public getIndex(item: T): number {
    return this._uidToIndex[item.uid] ?? -1;
  }
}
