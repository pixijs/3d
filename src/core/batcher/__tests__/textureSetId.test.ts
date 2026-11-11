import { getApp } from '@test-utils';
import { BufferImageSource, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { Material3D } from '~/materials/pbr/Material3D';

import { textureSetId } from '../textureSetId';

const slots = (uids: number[]) => uids.map((uid) => ({ source: { uid } }));

describe('textureSetId', () => {
  it('gives the same sources in the same slots one id, and anything else another', () => {
    const id = textureSetId(slots([30, 31, 1]));

    expect(textureSetId(slots([30, 31, 1]))).toBe(id);
    expect(textureSetId(slots([31, 30, 1])), 'slot order is part of the set').not.toBe(id);
    expect(textureSetId(slots([30, 31, 2])), 'a shared default in a slot is part of the set').not.toBe(id);
    expect(textureSetId(slots([30, 31])), 'the slot count is part of the set').not.toBe(id);
  });

  it('keeps sets apart across sequential and widely spaced uids', () => {
    const ids = new Set<number>();
    const sets = 4096;

    for (let i = 0; i < sets; i++) {
      ids.add(textureSetId(slots([i, i + 1, i + 2])));
      ids.add(textureSetId(slots([i * 0x1_0000, i * 0x1_0000 + 7])));
      ids.add(textureSetId(slots([i, 0x7fff_ffff - i, 1, 2, 3])));
    }

    expect(ids.size).toBe(sets * 3);
  });

  it('is assigned on a real material at construction and moves when a slot swaps source', async () => {
    const app = await getApp({ id: 'texture-set-id-material', appOptions: { width: 8, height: 8 } });

    try {
      const a = new Material3D({ baseColor: 0xff0000 });
      const b = new Material3D({ baseColor: 0x00ff00 });
      expect(a._textureSetId, 'two materials on the shared defaults are one set').toBe(b._textureSetId);

      const source = Texture.WHITE.source;
      const frame = new Texture({ source, frame: Texture.WHITE.frame.clone() });
      a.textures.baseColor = frame;
      expect(a._textureSetId, 'another frame of the same source is the same set').toBe(b._textureSetId);

      const own = new Texture({
        source: new BufferImageSource({ resource: new Uint8Array(4), format: 'rgba8unorm', width: 1, height: 1 }),
      });
      a.textures.baseColor = own;
      expect(a._textureSetId, 'a different source is a different set').not.toBe(b._textureSetId);
      expect(a._textureSetId).toBe(textureSetId(a._textures));

      a.textures.baseColor = Texture.WHITE;
      expect(a._textureSetId, 'swapping back returns to the shared set').toBe(b._textureSetId);

      a.destroy();
      b.destroy();
      own.destroy(true);
    } finally {
      app.destroy(true);
    }
  });
});
