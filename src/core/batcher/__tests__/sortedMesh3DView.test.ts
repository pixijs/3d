import { describe, expect, it, vi } from 'vitest';

import type { Mesh3DData } from '../Mesh3DData';
import { SortedMesh3DView } from '../SortedMesh3DView';

const item = (uid: number): Mesh3DData => ({ uid }) as unknown as Mesh3DData;

const fullSorts = (view: SortedMesh3DView<Mesh3DData>) =>
  vi.spyOn(view as unknown as { _sortFull(): void }, '_sortFull');

function forcedView(count: number) {
  const items = Array.from({ length: count }, (_, i) => item(i));
  const view = new SortedMesh3DView<Mesh3DData>(items, count);
  for (let i = 0; i < count; i++) view.add(i, i, 0);
  const keys = new Float64Array(count);
  const getKey = (m: Mesh3DData) => keys[m.uid];
  const order = () => Array.from(view.indices.subarray(0, view.count));
  const expectSorted = () => {
    const o = order();
    for (let i = 1; i < o.length; i++) expect(keys[o[i - 1]]).toBeLessThanOrEqual(keys[o[i]]);
  };
  return { view, keys, getKey, order, expectSorted };
}

function lcg(seed: number) {
  let state = seed >>> 0;
  return (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
}

describe('SortedMesh3DView', () => {
  it('patches the last order after small changes, with slots reused as the batch reuses them, matching a full sort', () => {
    const slots = 600;
    const items = Array.from({ length: slots }, (_, i) => item(i));
    const view = new SortedMesh3DView<Mesh3DData>(items, 1024);
    const next = lcg(7);
    const live = new Map<number, number>();
    let uid = 0;
    const place = (slot: number) => {
      const key = next(50);
      items[slot] = item(uid);
      view.add(uid++, slot, key);
      live.set(slot, key);
    };
    for (let slot = 0; slot < 500; slot++) place(slot);
    view.sort();

    const full = fullSorts(view);
    for (let frame = 0; frame < 200; frame++) {
      for (let c = 0; c < 1 + next(12); c++) {
        const op = next(3);
        const liveSlots = [...live.keys()];
        if (op === 0 && liveSlots.length > 0) {
          const slot = liveSlots[next(liveSlots.length)];
          view.remove(items[slot].uid);
          live.delete(slot);
        } else if (op === 1) {
          const free = Array.from({ length: slots }, (_, i) => i).filter((i) => !live.has(i));
          if (free.length > 0) place(free[next(free.length)]);
        } else if (liveSlots.length > 0) {
          const slot = liveSlots[next(liveSlots.length)];
          const key = next(50);
          view.updateKey(items[slot].uid, key);
          live.set(slot, key);
        }
      }
      view.sort();

      const order = Array.from(view.indices.subarray(0, view.count));
      expect(view.count).toBe(live.size);
      expect(new Set(order)).toEqual(new Set(live.keys()));
      for (let i = 1; i < order.length; i++) expect(live.get(order[i - 1])!).toBeLessThanOrEqual(live.get(order[i])!);
    }
    expect(full).not.toHaveBeenCalled();
  });

  it('keeps equal keys in their previous order, with newcomers after them', () => {
    const items = Array.from({ length: 4 }, (_, i) => item(i));
    const view = new SortedMesh3DView<Mesh3DData>(items);

    view.add(0, 0, 5);
    view.add(1, 1, 5);
    view.add(2, 2, 9);
    view.sort();
    view.add(3, 3, 5);
    view.sort();

    expect(Array.from(view.indices.subarray(0, 4))).toEqual([0, 1, 3, 2]);
  });

  it('sorts in full when over half the view changed, after a forced sort, and after a grow', () => {
    const items = Array.from({ length: 300 }, (_, i) => item(i));
    const view = new SortedMesh3DView<Mesh3DData>(items);
    for (let i = 0; i < 10; i++) view.add(i, i, 10 - i);
    view.sort();
    const full = fullSorts(view);

    for (let i = 10; i < 30; i++) view.add(i, i, i);
    view.sort();
    expect(full).toHaveBeenCalledTimes(1);

    view.sortForced((m) => m.uid);
    expect(full).toHaveBeenCalledTimes(2);
    view.add(30, 30, 0);
    view.sort();
    expect(full).toHaveBeenCalledTimes(3);

    for (let i = 31; i < 40; i++) view.add(i, i, i);
    view.sort();
    expect(full).toHaveBeenCalledTimes(4);
  });

  it('stops tracking a view that churns without ever sorting', () => {
    const items = [item(0), item(1)];
    const view = new SortedMesh3DView<Mesh3DData>(items);
    view.add(0, 0, 1);
    view.sort();

    for (let i = 0; i < 1000; i++) {
      view.add(1, 1, 2);
      view.remove(1);
    }

    const pendingCount = (view as unknown as { _pendingCount: number })._pendingCount;
    expect(pendingCount).toBeLessThanOrEqual(view.renderableIndices.length);
    view.sort();
    expect(Array.from(view.indices.subarray(0, view.count))).toEqual([0]);
  });

  describe('sortForced', () => {
    it('re-sorts its last order while the items stay the same and the camera orbits a degree a frame', () => {
      const { view, keys, getKey, expectSorted } = forcedView(500);
      const next = lcg(11);
      const x = Array.from({ length: 500 }, () => next(1000) - 500);
      const z = Array.from({ length: 500 }, () => next(1000) - 500);
      const full = fullSorts(view);

      for (let frame = 0; frame < 60; frame++) {
        const a = (frame * Math.PI) / 180;
        const cx = Math.cos(a) * 800;
        const cz = Math.sin(a) * 800;
        for (let i = 0; i < 500; i++) keys[i] = -((x[i] - cx) ** 2 + (z[i] - cz) ** 2);
        view.sortForced(getKey);
        expectSorted();
      }
      expect(full).toHaveBeenCalledTimes(1);
    });

    it('sorts in full after an add or a remove', () => {
      const { view, keys, getKey, expectSorted } = forcedView(20);
      for (let i = 0; i < 20; i++) keys[i] = i;
      view.remove(19);
      view.sortForced(getKey);
      const full = fullSorts(view);

      view.add(19, 19, 0);
      view.sortForced(getKey);
      expect(full).toHaveBeenCalledTimes(1);

      view.remove(3);
      view.sortForced(getKey);
      expect(full).toHaveBeenCalledTimes(2);
      expect(view.count).toBe(19);
      expectSorted();

      view.sortForced(getKey);
      expect(full).toHaveBeenCalledTimes(2);
    });

    it('sorts in full when one item leaves and another joins, keeping the count', () => {
      const { view, keys, getKey, order, expectSorted } = forcedView(20);
      for (let i = 0; i < 20; i++) keys[i] = i;
      view.remove(19);
      view.sortForced(getKey);
      const full = fullSorts(view);

      view.remove(3);
      view.add(19, 19, 0);
      view.sortForced(getKey);
      expect(full).toHaveBeenCalledTimes(1);
      expect(order()).toContain(19);
      expect(order()).not.toContain(3);
      expectSorted();
    });

    it('keeps equal keys in their last order', () => {
      const { view, keys, getKey, order } = forcedView(6);
      [4, 2, 5, 0, 3, 1].forEach((k, i) => (keys[i] = k));
      view.sortForced(getKey);
      const before = order();

      keys.fill(7);
      view.sortForced(getKey);
      expect(order()).toEqual(before);
    });

    it('falls back to the full sort when the order reverses, and still sorts', () => {
      const { view, keys, getKey, expectSorted } = forcedView(300);
      for (let i = 0; i < 300; i++) keys[i] = i;
      view.sortForced(getKey);
      const full = fullSorts(view);

      for (let i = 0; i < 300; i++) keys[i] = -i;
      view.sortForced(getKey);
      expect(full).toHaveBeenCalledTimes(1);
      expectSorted();
    });

    it('moves orderDirtyId only when a sort changes the order', () => {
      const { view, keys, getKey } = forcedView(50);
      for (let i = 0; i < 50; i++) keys[i] = i;
      view.sortForced(getKey);
      const first = view.orderDirtyId;

      for (let i = 0; i < 50; i++) keys[i] = i * 2 + 7;
      view.sortForced(getKey);
      expect(view.orderDirtyId, 'new keys in the same order').toBe(first);

      keys[10] = 23;
      keys[11] = 21;
      view.sortForced(getKey);
      expect(view.orderDirtyId, 'two neighbours swapped').toBe(first + 1);

      view.sortForced(getKey);
      expect(view.orderDirtyId, 'sorted again, nothing moved').toBe(first + 1);

      for (let i = 0; i < 50; i++) keys[i] = -i;
      view.sortForced(getKey);
      expect(view.orderDirtyId, 'reversed: the insertion sort gives up and the full sort takes over').toBeGreaterThan(
        first + 1,
      );
    });

    it('moves orderDirtyId on every full sort', () => {
      const { view, keys, getKey } = forcedView(4);
      for (let i = 0; i < 4; i++) keys[i] = i;
      view.sortForced(getKey);
      const sorts = fullSorts(view);
      const before = view.orderDirtyId;

      view.remove(3);
      view.add(3, 3, 0);
      view.sortForced(getKey);
      expect(sorts, 'a remove and an add force the full sort').toHaveBeenCalledTimes(1);
      expect(view.orderDirtyId, 'which bumps it, whatever order it writes').toBe(before + 1);
    });
  });
});
