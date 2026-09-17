import type { BindGroup } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { Mesh3DBatch } from '~/core/batcher/Mesh3DBatch';
import { CullResults } from '~/core/render-passes/CullResult';
import { DrawList } from '~/core/render-passes/DrawList';
import type { View3D } from '~/scene/View3D';

const groupA = {} as BindGroup;
const groupB = {} as BindGroup;

/** A draw list "built" with two commands of full counts, the way the batcher leaves it */
function builtList(): DrawList {
  const list = new DrawList({ items: [], label: 'test' });
  list.commandList.clear();
  list.commandList.next();
  list.commandList.next();
  list.drawData.ensureCapacity(2).set([6, 3, 0, 0, 0, 6, 2, 0, 0, 3]);
  return list;
}

const batch = (uid: number) => ({ uid }) as unknown as Mesh3DBatch;

describe('CullResult', () => {
  it('two owners on one draw list share the list and hold independent results', () => {
    const list = builtList();
    const a = new CullResults();
    const b = new CullResults();
    const ra = a.ensure(batch(1));
    const rb = b.ensure(batch(1));

    expect(ra).not.toBe(rb);
    expect(ra.sync(list)).toBe(true);
    expect(rb.sync(list)).toBe(true);
    expect(ra.sync(list)).toBe(false);

    // Each result carries the list's lanes; a cull rewriting one's counts leaves the other and the
    // list's template untouched.
    expect(Array.from(rb.indirectDrawData.drawCalls.subarray(0, 10))).toEqual([6, 3, 0, 0, 0, 6, 2, 0, 0, 3]);
    ra.indirectDrawData.drawCalls[1] = 1;
    expect(rb.indirectDrawData.drawCalls[1]).toBe(3);
    expect(list.drawData.drawCalls[1]).toBe(3);

    a.release();
    b.release();
  });

  it('a rebuild re-syncs the result, drops its bundle and forces the visibility walk', () => {
    const list = builtList();
    const results = new CullResults();
    const result = results.ensure(batch(1));
    result.sync(list);
    result.bundle = {} as never;
    result.lastVisibilityDirtyId = 7;
    list.gpuData.bundleDirtyId++;
    expect(result.isBundleStale(list, groupA)).toBe(true);
    result.claimBundleRecorded(list, groupA);
    expect(result.isBundleStale(list, groupA)).toBe(false);
    expect(result.isBundleStale(list, groupB)).toBe(true);

    // The batcher rebuilds: the command list is cleared (its dirty id moves) and the lanes change.
    list.commandList.clear();
    list.commandList.next();
    list.drawData.drawCalls.set([9, 5, 0, 0, 0]);

    expect(result.sync(list)).toBe(true);
    expect(result.bundle).toBeNull();
    expect(result.lastVisibilityDirtyId).toBe(-1);
    expect(Array.from(result.indirectDrawData.drawCalls.subarray(0, 5))).toEqual([9, 5, 0, 0, 0]);

    results.release();
  });

  it('removes results for detached batches, once per batch-list change', () => {
    const results = new CullResults();
    const kept = batch(1);
    const gone = batch(2);
    const view = { _meshBatchesDirtyId: 1, _meshBatches: [kept, gone] };
    const reconcile = () => results.removeDetached(view as unknown as View3D);
    const r1 = results.ensure(kept);
    const r2 = results.ensure(gone, 1);

    reconcile();
    expect(results.get(kept)).toBe(r1);
    expect(results.get(gone, 1)).toBe(r2);

    // Same dirty id: the sweep is skipped even though the batch list shrank.
    view._meshBatches = [kept];
    reconcile();
    expect(results.get(gone, 1)).toBe(r2);

    view._meshBatchesDirtyId++;
    reconcile();
    expect(results.get(gone, 1)).toBeUndefined();
    expect(results.get(kept)).toBe(r1);

    // Removing hands one result back; a missing index is a no-op, and the others stay.
    results.ensure(kept, 1);
    results.ensure(kept, 2);
    results.remove(kept, 2);
    results.remove(kept, 3);
    expect(results.get(kept, 2)).toBeUndefined();
    expect(results.get(kept, 1)).toBeDefined();
    results.remove(kept, 1);
    expect(results.get(kept, 1)).toBeUndefined();
    expect(results.get(kept)).toBe(r1);

    results.release();
    expect(results.get(kept)).toBeUndefined();
  });
});
