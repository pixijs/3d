type IndexKey<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T];

type Indexed<T> = Record<IndexKey<T>, number>;

/**
 * Removing an item moves the last one into its slot and updates its index property; an index kept elsewhere goes stale
 * @internal
 */
export class UnstableList<T> {
  public items: T[] = [];
  private readonly _indexKey: IndexKey<T>;

  /**
   * @param indexKey - Item property holding its index, `-1` while unlisted; items start at `-1` and need one per list
   */
  constructor(indexKey: IndexKey<T>) {
    this._indexKey = indexKey;
  }

  /** Doesn't check for duplicates: adding a listed item leaves a copy `remove` can't reach */
  public add(item: T): void {
    (item as Indexed<T>)[this._indexKey] = this.items.length;
    this.items.push(item);
  }

  public remove(item: T): void {
    const index = (item as Indexed<T>)[this._indexKey];

    if (index > -1) {
      const lastIndex = this.items.length - 1;
      const lastItem = this.items[lastIndex];

      this.items[index] = lastItem;
      (lastItem as Indexed<T>)[this._indexKey] = index;

      this.items.length = lastIndex;

      (item as Indexed<T>)[this._indexKey] = -1;
    }
  }

  public clear(): void {
    for (let i = 0; i < this.items.length; i++) {
      (this.items[i] as Indexed<T>)[this._indexKey] = -1;
    }
    this.items.length = 0;
  }
}
