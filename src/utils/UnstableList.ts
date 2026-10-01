/**
 * Dense list with O(1) removal via swap-and-pop
 *
 * Each item stores its own index under `indexKey`, so removal needs no
 * search — but indices are unstable: removing an item moves the last item
 * into its slot. Use {@link StableList} when indices must survive removals.
 * @internal
 */
export class UnstableList<T> {
  /** Backing array — dense, no holes */
  public items: T[] = [];
  private _indexKey: keyof T;

  /**
   * @param indexKey - Property on each item where the list keeps that item's index, `-1` while the
   * item is not in the list. Items must start it at `-1`, because `remove` trusts any index of 0 or
   * more. An item that sits in several lists needs one property per list.
   */
  constructor(indexKey: keyof T) {
    this._indexKey = indexKey;
  }

  /**
   * Appends `item` and writes its index onto it
   *
   * Does not check for duplicates: adding an item twice leaves a copy that `remove` can't reach.
   * @param item - the item to append
   */
  public add(item: T): void {
    (item as any)[this._indexKey] = this.items.length;
    this.items.push(item);
  }

  /**
   * Removes `item` and resets its index to -1; a no-op when the index is already -1
   * @param item - the item to remove
   */
  public remove(item: T): void {
    const index = (item as any)[this._indexKey] as number;

    if (index > -1) {
      const lastIndex = this.items.length - 1;
      const lastItem = this.items[lastIndex];

      this.items[index] = lastItem;
      (lastItem as any)[this._indexKey] = index;

      this.items.length = lastIndex;

      (item as any)[this._indexKey] = -1;
    }
  }

  /** Clears the list and resets the index property on all items */
  public clear(): void {
    for (let i = 0; i < this.items.length; i++) {
      (this.items[i] as any)[this._indexKey] = -1;
    }
    this.items.length = 0;
  }
}
