import { Buffer, BufferUsage } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { Buffer3D } from '~/core/buffers/Buffer3D';
import { DataStoreBuffer } from '~/core/buffers/DataStoreBuffer';

describe('Buffer3D', () => {
  it('is exempt from the renderer GC, unlike a plain pixi Buffer', () => {
    const options = {
      data: new Float32Array(4),
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST,
    };
    const plain = new Buffer(options);
    const exempt = new Buffer3D(options);

    expect(plain.autoGarbageCollect).toBe(true);
    expect(exempt.autoGarbageCollect).toBe(false);

    plain.destroy();
    exempt.destroy();
  });

  it('keeps growth replacements exempt', () => {
    const buf = new DataStoreBuffer({
      stride: 4,
      initialSize: 2,
      indexKey: '_storeIndex',
      copier: () => {},
    });
    const initial = buf.buffer;

    // allocateBlock past the initial capacity forces _expand, which mints a
    // replacement buffer and retires the initial one.
    buf.allocateBlock({}, 100);

    expect(buf.buffer).not.toBe(initial);
    expect(buf.buffer.autoGarbageCollect).toBe(false);
    expect(initial.autoGarbageCollect).toBe(false);

    buf.destroy();
  });
});
