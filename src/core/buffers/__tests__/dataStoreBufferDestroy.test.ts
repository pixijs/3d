import type { Buffer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { DataStoreBuffer } from '~/core/buffers/DataStoreBuffer';

describe('DataStoreBuffer.destroy', () => {
  it('frees the GPU buffers orphaned by growth', () => {
    const buf = new DataStoreBuffer({
      stride: 4,
      initialSize: 2,
      indexKey: '_storeIndex',
      copier: () => {},
    });

    const initial: Buffer = buf.buffer;

    // allocateBlock past the initial capacity forces _expand, which retires the
    // initial buffer (a new one is minted to keep in-flight bundles valid).
    buf.allocateBlock({}, 100);
    expect(buf.buffer).not.toBe(initial);
    expect(initial.destroyed).toBe(false);

    buf.destroy();

    // The retired buffer is GC-exempt, so it is only reclaimed if destroy() frees it explicitly.
    expect(initial.destroyed).toBe(true);
    expect(buf.buffer).toBe(null);
  });

  // Items outlive the store and reach it through a back-reference; once the
  // store is gone those calls must be inert, not write into the dropped arrays.
  it('set and remove are inert through a stale back-reference', () => {
    const buf = new DataStoreBuffer({
      stride: 4,
      initialSize: 2,
      indexKey: '_storeIndex',
      copier: () => {},
    });
    const resident = { _storeIndex: -1 };
    buf.set(resident);
    buf.destroy();

    // The index reset is what lets the item re-mint in a fresh store.
    expect(() => buf.remove(resident)).not.toThrow();
    expect(resident._storeIndex).toBe(-1);

    const late = { _storeIndex: -1 };
    expect(buf.set(late)).toBe(-1);
    expect(late._storeIndex).toBe(-1);
  });
});
