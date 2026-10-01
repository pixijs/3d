import { describe, expect, it } from 'vitest';

import { DataStoreBuffer } from '~/core/buffers/DataStoreBuffer';

describe('Buffer3D', () => {
  it('keeps the buffer growth retires, and the one it makes, exempt from the GC', () => {
    const buf = new DataStoreBuffer({
      stride: 4,
      initialSize: 2,
      indexKey: '_storeIndex',
      copier: () => {},
    });
    const initial = buf.buffer;

    buf.allocateBlock({}, 100);

    expect(buf.buffer).not.toBe(initial);
    expect(buf.buffer.autoGarbageCollect).toBe(false);
    expect(initial.autoGarbageCollect).toBe(false);

    buf.destroy();
  });
});
