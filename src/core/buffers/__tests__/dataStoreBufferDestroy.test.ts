import { RendererType } from 'pixi.js';
import type { Buffer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { DataStoreBuffer } from '~/core/buffers/DataStoreBuffer';
import { MaterialDataStoreBuffer } from '~/core/buffers/MaterialDataStoreBuffer';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';

function createStore(): DataStoreBuffer {
  return new DataStoreBuffer({
    stride: 4,
    initialSize: 2,
    indexKey: '_storeIndex',
    copier: () => {},
  });
}

describe('DataStoreBuffer.destroy', () => {
  it('frees the GPU buffers orphaned by growth', () => {
    const buf = createStore();

    const initial: Buffer = buf.buffer;

    buf.allocateBlock({}, 100);
    expect(buf.buffer).not.toBe(initial);
    expect(initial.destroyed, 'growth retires the old buffer so bundles recorded with it stay valid').toBe(false);

    buf.destroy();

    expect(initial.destroyed, 'the GC never frees a retired buffer, so destroy has to').toBe(true);
    expect((buf as unknown as { _buffer: unknown })._buffer).toBe(null);
  });

  it('frees the data textures orphaned by growth', () => {
    const buf = createStore();
    const initial = buf.texture;
    const initialSource = initial.source;

    buf.allocateBlock({}, 100);
    const grown = buf.texture;
    const grownSource = grown.source;
    expect(grown).not.toBe(initial);
    expect(initial.destroyed).toBe(false);

    buf.destroy();

    expect(initial.destroyed).toBe(true);
    expect(initialSource.destroyed).toBe(true);
    expect(grown.destroyed).toBe(true);
    expect(grownSource.destroyed).toBe(true);
  });

  it('set and remove do nothing once the store is destroyed, for the items that outlive it', () => {
    const buf = createStore();
    const resident = { _storeIndex: -1 };
    buf.set(resident);
    buf.destroy();

    expect(() => buf.remove(resident)).not.toThrow();
    expect(resident._storeIndex, 'the reset index lets the item re-mint in a fresh store').toBe(-1);

    const late = { _storeIndex: -1 };
    expect(buf.set(late)).toBe(-1);
    expect(late._storeIndex).toBe(-1);
  });
});

describe('MaterialDataStoreBuffer.destroy', () => {
  it('frees its data texture and every texture growth retired, and a second call does nothing', () => {
    const store = new MaterialDataStoreBuffer({ alignment: 256, rendererType: RendererType.WEBGPU });
    const initial = store.texture;
    const initialSource = initial.source;
    const materials: FlatMaterial[] = [];

    for (let i = 0; i < 1000 && store.texture === initial; i++) {
      const material = new FlatMaterial();
      store.register(material);
      materials.push(material);
    }
    const grown = store.texture;
    const grownSource = grown.source;
    expect(grown).not.toBe(initial);
    expect(initial.destroyed, 'a view that drew earlier in the frame still holds the old texture').toBe(false);

    store.destroy();

    expect(initial.destroyed).toBe(true);
    expect(initialSource.destroyed).toBe(true);
    expect(grown.destroyed).toBe(true);
    expect(grownSource.destroyed).toBe(true);
    expect(() => store.destroy()).not.toThrow();

    for (const material of materials) material.destroy();
  });
});

describe('DataStoreBuffer.unload', () => {
  it('frees the data textures orphaned by growth and keeps the live one, sized to the grown store', () => {
    const buf = createStore();
    const initial = buf.texture;
    const initialSource = initial.source;

    buf.allocateBlock({}, 100);
    const grown = buf.texture;

    buf.unload();

    expect(initial.destroyed).toBe(true);
    expect(initialSource.destroyed).toBe(true);
    expect(buf.texture).toBe(grown);
    expect(grown.destroyed).toBe(false);
    expect(grown.source.pixelWidth * grown.source.pixelHeight * 4, 'four words per rgba32uint texel').toBe(
      buf.data.length,
    );

    buf.destroy();
    expect(grown.destroyed).toBe(true);
  });
});
