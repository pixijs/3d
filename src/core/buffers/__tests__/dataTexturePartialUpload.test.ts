import type { BufferImageSource, TextureSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { BONE_MATRIX_FLOATS, BonePit } from '~/core/buffers/BonePit';
import { MorphStoreBuffer } from '~/core/buffers/MorphStoreBuffer';
import { RenderInstanceTexture } from '~/core/buffers/RenderInstanceTexture';
import type { Mesh3D } from '~/scene/Mesh3D';
import { Morph } from '~/scene/Morph';
import type { Skeleton } from '~/scene/Skeleton';

const spyUpdate = (source: TextureSource) => vi.spyOn(source as BufferImageSource, 'update');

describe('data textures upload a texel range instead of the whole texture', () => {
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
      _morph: new Morph(new Float32Array([0, 0])),
      _storeDirty: false,
      _markStoreDirty(this: { _storeDirty: boolean }) {
        this._storeDirty = true;
      },
    } as unknown as Mesh3D;

    store.sync([mesh]);
    store.update();

    const update = spyUpdate(store.texture.source);
    mesh._morph!.weights[1] = 0.5;
    store.sync([mesh]);
    store.update();

    const texel = Math.floor(mesh._morph!._weightIndex / 4);
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
      _worldId: 0,
    } as unknown as Skeleton;

    pit.add(skeleton);
    pit.update();

    expect(update.mock.calls).toEqual([[0, (4 * BONE_MATRIX_FLOATS) / 4]]);
    pit.destroy();
  });

  it('RenderInstanceTexture uploads the span it is given, and a new array matches no store row', () => {
    const indexTexture = new RenderInstanceTexture(256);
    const update = spyUpdate(indexTexture.texture.source);

    expect(
      indexTexture.data.every((texel) => texel === 0xffffffff),
      'a fresh array',
    ).toBe(true);

    indexTexture.upload(3, 5);
    indexTexture.upload(10, 10);

    expect(update.mock.calls, 'an empty span uploads nothing').toEqual([[3, 5]]);

    indexTexture.ensureCapacity(1000);

    expect(
      indexTexture.data.every((texel) => texel === 0xffffffff),
      'a regrown array',
    ).toBe(true);
    indexTexture.destroy();
  });
});
