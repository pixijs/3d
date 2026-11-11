interface HasUid {
  uid: number;
}

/**
 * Removal leaves a `null` hole, so an item's index holds while it is listed; walkers of `items` skip holes
 * @internal
 */
export class StableList<T extends HasUid> {
  /** Never replaced, since `View3D._sceneBatch` keeps a reference to it */
  public readonly items: (T | null)[] = [];

  /** Count of slots ever used, holes included, not of live items */
  public count = 0;

  private _freeList: Uint32Array = new Uint32Array(1024);
  private _freeCount = 0;
  private readonly _uidToIndex = new Map<number, number>();

  /** Doesn't check for duplicates: adding a listed item strands its first slot */
  public add(item: T): void {
    let index: number;

    if (this._freeCount > 0) {
      index = this._freeList[--this._freeCount];
    } else {
      index = this.count++;
    }

    this.items[index] = item;
    this._uidToIndex.set(item.uid, index);
  }

  public remove(item: T): void {
    const index = this._uidToIndex.get(item.uid);
    if (index === undefined) return;

    this.items[index] = null;
    this._uidToIndex.delete(item.uid);

    if (this._freeCount >= this._freeList.length) {
      const bigger = new Uint32Array(this._freeList.length * 2);
      bigger.set(this._freeList);
      this._freeList = bigger;
    }

    this._freeList[this._freeCount++] = index;
  }

  public getIndex(item: T): number {
    return this._uidToIndex.get(item.uid) ?? -1;
  }
}
