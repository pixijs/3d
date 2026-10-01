interface HasUid {
  /** Key {@link StableList} finds an item's slot by, so no two items may share one */
  uid: number;
}

/**
 * List whose items keep the same index for as long as they are in it
 *
 * Removing an item leaves a `null` hole rather than moving another item into the gap, and the next
 * `add` fills the most recently freed hole. An index can therefore be stored elsewhere and stay
 * valid, but anyone walking `items` has to skip the holes. Use {@link UnstableList} when the list
 * must stay dense and indices may move.
 * @internal
 */
export class StableList<T extends HasUid> {
  /**
   * Items by index, with `null` in each freed slot
   *
   * The array is never replaced, so a holder can keep a reference to it, as `View3D` does for its
   * scene batch.
   */
  public readonly items: (T | null)[] = [];

  /** High-water mark: every slot allocated so far, holes included. Not the number of live items */
  public count = 0;

  private _freeList: Uint32Array = new Uint32Array(1024);
  private _freeCount = 0;
  private _uidToIndex: Record<number, number> = Object.create(null);

  /**
   * Stores `item` in the most recently freed slot, or in a new one at the end
   *
   * Does not check for duplicates: adding an item that is already in the list strands its first slot.
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
   * Empties the slot `item` occupies and queues its index for reuse; a no-op when the item isn't in the list
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
