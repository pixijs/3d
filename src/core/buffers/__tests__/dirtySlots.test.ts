import { describe, expect, it, vi } from 'vitest';

import { DataStoreBuffer } from '~/core/buffers/DataStoreBuffer';
import { BUFFER_CALL_BYTES, DirtySlots, TEXTURE_CALL_BYTES } from '~/core/buffers/DirtySlots';

const SLOT_BYTES = 96;

function runsOf(dirty: DirtySlots): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < dirty.runCount; r++) out.push([dirty.runs[r * 2], dirty.runs[r * 2 + 1]]);
  return out;
}

describe('DirtySlots', () => {
  it('joins changed slots with up to 8 clean slots between them into one run and splits the rest', () => {
    const dirty = new DirtySlots(24_000, SLOT_BYTES);
    for (const slot of [100, 102, 110, 119, 129, 5000, 23_999]) dirty.mark(slot);

    dirty.planRuns();

    expect(runsOf(dirty), '119 joins after 8 clean slots, 129 starts a run after 9').toEqual([
      [100, 120],
      [129, 130],
      [5000, 5001],
      [23_999, 24_000],
    ]);
    expect(dirty.runSlots).toBe(23);
    expect(dirty.runsBeatSpan(BUFFER_CALL_BYTES)).toBe(true);
    expect(dirty.runsBeatSpan(TEXTURE_CALL_BYTES)).toBe(true);
  });

  it('walks fully marked words in one step and still joins them into the right runs', () => {
    const dirty = new DirtySlots(24_000, SLOT_BYTES);
    for (let slot = 30; slot < 200; slot++) dirty.mark(slot);
    for (let slot = 1024; slot < 1088; slot++) dirty.mark(slot);
    dirty.mark(5000);

    dirty.planRuns();

    expect(runsOf(dirty), 'partial words either side of full ones, two full words alone, one slot').toEqual([
      [30, 200],
      [1024, 1088],
      [5000, 5001],
    ]);
    expect(dirty.runSlots).toBe(170 + 64 + 1);
  });

  it('sends one span when separate runs would cost more than it', () => {
    const dirty = new DirtySlots(24_000, SLOT_BYTES);
    for (let slot = 0; slot < 2000; slot += 20) dirty.mark(slot);

    dirty.planRuns();

    expect(dirty.runCount, '20 slots apart, past the 8-slot merge').toBe(100);
    expect(dirty.runsBeatSpan(BUFFER_CALL_BYTES), '100 calls cost more than the 190 KB span').toBe(false);
  });

  it('lets each GPU copy weigh the same runs against its own call cost', () => {
    const dirty = new DirtySlots(24_000, SLOT_BYTES);
    for (let slot = 0; slot < 24_000; slot += 120) dirty.mark(slot);

    dirty.planRuns();

    expect(dirty.runCount).toBe(200);
    expect(dirty.runsBeatSpan(BUFFER_CALL_BYTES), '200 calls at 8 KB beat a 2.3 MB span').toBe(true);
    expect(dirty.runsBeatSpan(TEXTURE_CALL_BYTES), '200 calls at 16 KB lose to it').toBe(false);
  });

  it('sends one span when the span is under the floor, however few slots changed', () => {
    const dirty = new DirtySlots(100_000, SLOT_BYTES);
    dirty.mark(0);
    dirty.mark(23_999);
    dirty.planRuns();

    expect(dirty.runsBeatSpan(BUFFER_CALL_BYTES, 3 * 1024 * 1024), 'a 2.3 MB span is under a 3 MB floor').toBe(false);
    expect(dirty.runsBeatSpan(BUFFER_CALL_BYTES, 2 * 1024 * 1024)).toBe(true);
    expect(dirty.runsBeatSpan(BUFFER_CALL_BYTES)).toBe(true);
  });

  it('sends one changed slot as one span', () => {
    const one = new DirtySlots(24_000, SLOT_BYTES);
    one.mark(42);
    one.planRuns();

    expect(one.runCount).toBe(1);
    expect(one.runsBeatSpan(BUFFER_CALL_BYTES)).toBe(false);
  });

  it('sends a marked range as one span', () => {
    const dirty = new DirtySlots(24_000, SLOT_BYTES);
    dirty.mark(5);
    dirty.markRange(1000, 1999);
    dirty.mark(20_000);

    dirty.planRuns();

    expect(
      [dirty.runsBeatSpan(BUFFER_CALL_BYTES), dirty.runsBeatSpan(TEXTURE_CALL_BYTES)],
      'the range sends the whole upload as one span, marks after it included',
    ).toEqual([false, false]);
    expect([dirty.min, dirty.max]).toEqual([5, 20_000]);
  });

  it('forgets every mark after an upload, planned or not', () => {
    const dirty = new DirtySlots(24_000, SLOT_BYTES);
    dirty.mark(10);
    dirty.mark(20_000);
    dirty.clear();

    expect(dirty.isEmpty).toBe(true);
    dirty.mark(30);
    dirty.mark(20_030);
    dirty.planRuns();
    expect(runsOf(dirty), 'the slots marked before the clear are gone').toEqual([
      [30, 31],
      [20_030, 20_031],
    ]);
  });

  it('keeps its marks through growth', () => {
    const dirty = new DirtySlots(1000, SLOT_BYTES);
    dirty.mark(3);
    dirty.grow(100_000);
    dirty.mark(90_000);

    dirty.planRuns();

    expect(runsOf(dirty)).toEqual([
      [3, 4],
      [90_000, 90_001],
    ]);
  });
});

describe('DataStoreBuffer uploads runs of changed slots', () => {
  const store24 = () =>
    new DataStoreBuffer({ stride: 24, initialSize: 24_000, indexKey: '_storeIndex', copier: () => {} });

  it('writes each run of scattered slots to the storage buffer, not the span between them', () => {
    const store = store24();
    const update = vi.spyOn(store.buffer, 'update');

    store.markDirty(10);
    store.markDirty(12);
    store.markDirty(20_000);
    store.update();

    expect(update.mock.calls, '[size, offset] in bytes per run').toEqual([
      [3 * 96, 10 * 96],
      [96, 20_000 * 96],
    ]);
    store.destroy();
  });
});
