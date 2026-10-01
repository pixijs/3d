import type { BufferImageSource, TextureSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { BONE_MATRIX_FLOATS, BonePit } from '~/core/buffers/BonePit';
import { DataStoreBuffer } from '~/core/buffers/DataStoreBuffer';
import { MorphStoreBuffer } from '~/core/buffers/MorphStoreBuffer';
import { RenderInstanceTexture } from '~/core/buffers/RenderInstanceTexture';
import type { Mesh3D } from '~/scene/Mesh3D';
import { Morph } from '~/scene/Morph';
import type { Skeleton } from '~/scene/Skeleton';

/** Spies on a data texture's `update`, the call that carries the texel range to pixi */
const spyUpdate = (source: TextureSource) => vi.spyOn(source as BufferImageSource, 'update');

describe('data textures upload a texel range instead of the whole texture', () => {
  it('DataStoreBuffer uploads the texels spanning its dirty slots', () => {
    const store = new DataStoreBuffer({ stride: 24, indexKey: '_storeIndex', copier: () => {} });
    const update = spyUpdate(store.texture.source);

    store.set({ _storeIndex: 5 });
    store.set({ _storeIndex: 7 });
    store.update();

    expect(update.mock.calls, 'slots 5 to 7, six texels each').toEqual([[30, 48]]);
    store.destroy();
  });

  it('MorphStoreBuffer uploads the texels spanning its dirty floats', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 64, weightCapacity: 64 });
    const mesh = {
      geometry: {
        uid: 0,
        _morphDeltaBase: -1,
        _morphDeltaFloats: 0,
        _morphStore: null,
        _morphTargets: [{ positions: new Float32Array(3) }, { positions: new Float32Array(3) }],
      },
      morph: new Morph(new Float32Array([0, 0])),
      _storeDirty: false,
    } as unknown as Mesh3D;

    store.sync([mesh]);
    store.update();

    const update = spyUpdate(store.texture.source);
    mesh.morph!.weights[1] = 0.5;
    store.sync([mesh]);
    store.update();

    const texel = Math.floor(mesh.morph!._weightIndex / 4);
    expect(update.mock.calls, 'one changed weight marks its whole two-float slot, which sits in one texel').toEqual([
      [texel, texel + 1],
    ]);
    store.destroy();
  });

  it('BonePit uploads the texels its bones use', () => {
    const pit = new BonePit({ initialBoneCapacity: 64 });
    const update = spyUpdate(pit.texture.source);
    const skeleton = {
      jointCount: 4,
      worldMatrix: new Float32Array(4 * BONE_MATRIX_FLOATS),
      _bonePitTick: -1,
    } as unknown as Skeleton;

    pit.add(skeleton);
    pit.update();

    expect(update.mock.calls).toEqual([[0, (4 * BONE_MATRIX_FLOATS) / 4]]);
    pit.destroy();
  });

  it('RenderInstanceTexture uploads the texels of the slots in use', () => {
    const indexTexture = new RenderInstanceTexture(256);
    const update = spyUpdate(indexTexture.texture.source);

    indexTexture.upload(10);

    expect(update.mock.calls).toEqual([[0, 10]]);
    indexTexture.destroy();
  });
});
