import type { BufferImageSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { uploadFloatRange, uploadTexelRange } from '~/core/buffers/dataTextureLayout';

function spySource() {
  const update = vi.fn<(start: number, end: number) => void>();

  return { update, source: { update } as unknown as BufferImageSource };
}

describe('data texture upload ranges', () => {
  it('uploadFloatRange rounds a float range outward to whole texels', () => {
    const { update, source } = spySource();

    uploadFloatRange(source, 8, 16);
    uploadFloatRange(source, 5, 11);

    expect(update.mock.calls).toEqual([
      [2, 4],
      [1, 3],
    ]);
  });

  it('uploadTexelRange keeps a range shorter than one row exact, even across a row boundary', () => {
    const { update, source } = spySource();

    uploadTexelRange(source, 100, 116);
    uploadTexelRange(source, 4090, 4100);

    expect(update.mock.calls).toEqual([
      [100, 116],
      [4090, 4100],
    ]);
  });

  it('uploadTexelRange widens a range of one row or more to whole rows', () => {
    const { update, source } = spySource();

    uploadTexelRange(source, 6, 12006);
    uploadTexelRange(source, 5000, 9096);
    uploadTexelRange(source, 4096, 8192);

    expect(update.mock.calls).toEqual([
      [0, 12288],
      [4096, 12288],
      [4096, 8192],
    ]);
  });
});
