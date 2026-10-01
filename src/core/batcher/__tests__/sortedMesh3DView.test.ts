import { describe, expect, it } from 'vitest';

import type { Mesh3DData } from '../Mesh3DData';
import { SortedMesh3DView } from '../SortedMesh3DView';

/** The view only reads `uid` off its items (via the swap-and-pop remove). */
const item = (uid: number): Mesh3DData => ({ uid }) as unknown as Mesh3DData;

describe('SortedMesh3DView', () => {
  it('grows straight to the floor when it outgrows the initial capacity', () => {
    const items = Array.from({ length: 40 }, (_, i) => item(i));
    const view = new SortedMesh3DView<Mesh3DData>(items);

    for (let i = 0; i < items.length; i++) view.add(i, i, i);

    expect(view.count).toBe(40);
    expect(view.renderableIndices.length).toBe(256);
  });

  it('leaves the view clean when a key update changes nothing, as a swap to an equivalent material does', () => {
    const items = [item(1), item(2)];
    const view = new SortedMesh3DView<Mesh3DData>(items);

    view.add(1, 0, 100);
    view.add(2, 1, 200);
    view.sort();
    expect(view.dirty).toBe(false);

    view.updateKey(1, 100);
    expect(view.dirty).toBe(false);

    view.updateKey(1, 300);
    expect(view.dirty).toBe(true);
  });

  it('still reorders when a key actually moves', () => {
    const items = [item(1), item(2)];
    const view = new SortedMesh3DView<Mesh3DData>(items);

    view.add(1, 0, 100);
    view.add(2, 1, 200);
    view.sort();
    expect(Array.from(view.indices.subarray(0, 2))).toEqual([0, 1]);

    view.updateKey(1, 300);
    view.sort();
    expect(Array.from(view.indices.subarray(0, 2))).toEqual([1, 0]);
  });

  it('renderableIndices is current before sort; indices only after', () => {
    const items = Array.from({ length: 10 }, (_, i) => item(i));
    const view = new SortedMesh3DView<Mesh3DData>(items);

    view.add(5, 5, 3);
    view.add(2, 2, 1);
    view.add(9, 9, 2);
    expect(Array.from(view.renderableIndices.subarray(0, 3))).toEqual([5, 2, 9]);
    expect(Array.from(view.indices.subarray(0, 3))).toEqual([0, 0, 0]);

    view.sort();
    expect(Array.from(view.indices.subarray(0, 3))).toEqual([2, 9, 5]);

    view.remove(5);
    expect(Array.from(view.renderableIndices.subarray(0, 2))).toEqual([9, 2]);
    expect(Array.from(view.indices.subarray(0, 3))).toEqual([2, 9, 5]);
  });
});
