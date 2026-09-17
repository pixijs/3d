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
   * Creates a list that tracks indices under `indexKey`
   * @param indexKey - The property name on the object where the index should
   * be stored. The object should initialize this property to -1.
   */
  constructor(indexKey: keyof T) {
    this._indexKey = indexKey;
  }

  /**
   * Adds an item to the list and updates its index property
   * @param item - the item to append
   */
  public add(item: T): void {
    (item as any)[this._indexKey] = this.items.length;
    this.items.push(item);
  }

  /**
   * Removes an item from the list in O(1) time using swap-and-pop
   * @param item - the item to remove; its index property is reset to -1
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
