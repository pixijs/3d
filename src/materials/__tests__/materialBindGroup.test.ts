import { RendererType, Texture, TextureSource } from 'pixi.js';
import type { BufferResource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { MaterialDataStoreBuffer } from '~/core/buffers/MaterialDataStoreBuffer';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';

const makeTexture = () => new Texture({ source: new TextureSource({ width: 2, height: 2 }) });

const makeStore = () => new MaterialDataStoreBuffer({ alignment: 256, rendererType: RendererType.WEBGPU });

const keyOf = (group: { _keyLow: number; _keyHigh: number }) => `${group._keyLow}:${group._keyHigh}`;

const listeners = (emitter: { listenerCount(event: 'change'): number }) => emitter.listenerCount('change');

function grow(store: MaterialDataStoreBuffer): FlatMaterial[] {
  const version = store.bufferVersion;
  const materials: FlatMaterial[] = [];
  for (let i = 0; i < 100_000 && store.bufferVersion === version; i++) {
    const material = new FlatMaterial();
    store.register(material);
    materials.push(material);
  }
  expect(store.bufferVersion).toBe(version + 1);

  return materials;
}

describe('BaseMaterial3D bind group', () => {
  it('re-points a swapped slot, and keys two materials with the same textures apart by their rows', () => {
    const store = makeStore();
    const a = makeTexture();
    const b = makeTexture();
    const first = new FlatMaterial({ baseColorTexture: a });
    const second = new FlatMaterial({ baseColorTexture: a });
    store.register(first);
    store.register(second);

    const groupA = first._getBindGroup();
    const groupB = second._getBindGroup();
    expect(groupA).not.toBe(groupB);
    expect(groupA.getResource(0)).toBe(groupB.getResource(0));
    expect(groupA.getResource(2), 'each material binds its own row').not.toBe(groupB.getResource(2));
    expect(keyOf(groupA)).not.toBe(keyOf(groupB));

    const before = keyOf(groupA);
    first.textures.baseColor = b;
    expect(groupA.getResource(0), 'a swap drops the group whole, for any command still binding it').toBe(a.source);
    const swapped = first._getBindGroup();
    expect(swapped, 'the next use builds a new group').not.toBe(groupA);
    expect(swapped.getResource(0)).toBe(b.source);
    expect(swapped.getResource(1)).toBe(b.source.style);
    expect(keyOf(swapped), 'keyed by the new source').not.toBe(before);

    first.destroy();
    second.destroy();
    a.destroy(true);
    b.destroy(true);
    store.destroy();
  });

  it('re-points the row after the store grows, keeping the group and raising no bound-resource warning', () => {
    const store = makeStore();
    const material = new Material3D();
    store.register(material);
    const group = material._getBindGroup();
    const binding = material._textures.length * 2;
    const row = group.getResource(binding) as BufferResource;
    const before = keyOf(group);

    const filler = grow(store);
    expect(group.getResource(binding), 'growth touches no group; the next build re-points it').toBe(row);
    expect(row.destroyed).toBe(false);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let again: ReturnType<typeof material._getBindGroup>;
    try {
      again = material._getBindGroup();
    } finally {
      warn.mockRestore();
    }

    expect(again, 'the group is kept').toBe(group);
    const fresh = group.getResource(binding) as BufferResource;
    expect(fresh).not.toBe(row);
    expect(fresh).toBe(store.uniformResource(material));
    expect(fresh.offset, 'the place did not move').toBe(row.offset);
    expect(row.destroyed, 'the store destroyed the stale resource').toBe(true);
    expect(keyOf(group), 'the group re-keyed for the new resource').not.toBe(before);
    expect(warn.mock.calls, 'the row is held unwatched, so its replacement is not a destroyed bound resource').toEqual(
      [],
    );
    expect(material._getBindGroup().getResource(binding), 'and the next call changes nothing').toBe(fresh);

    material.destroy();
    for (const m of filler) m.destroy();
    store.destroy();
  });

  it('drops the bind group on unload and builds a new one on the next use, keeping the row; destroy lets the row go', () => {
    const store = makeStore();
    const texture = makeTexture();
    const material = new FlatMaterial({ baseColorTexture: texture });
    store.register(material);

    const group = material._getBindGroup();
    const binding = material._textures.length * 2;
    const row = group.getResource(binding);

    material.unload();
    expect(group.getResource(0), 'unload dropped the group whole, for any draw command still binding it').toBe(
      texture.source,
    );
    expect(material._uniformResource, 'the row stays with the place').toBe(row);
    expect(row.destroyed).toBe(false);

    const rebuilt = material._getBindGroup();
    expect(rebuilt).not.toBe(group);
    expect(rebuilt.getResource(0)).toBe(texture.source);
    expect(rebuilt.getResource(binding), 'the same row is bound again').toBe(row);

    material.destroy();
    expect(rebuilt.getResource(0), 'destroy drops the group without taking it apart').toBe(texture.source);
    expect(material._uniformResource).toBeNull();
    expect(row.destroyed).toBe(true);
    texture.destroy(true);
    store.destroy();
  });

  it('destroy({ texture, textureSource }) destroys the textures its dropped bind group holds without a warning', () => {
    const store = makeStore();
    const texture = makeTexture();
    const material = new FlatMaterial({ baseColorTexture: texture });
    store.register(material);
    const group = material._getBindGroup();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      material.destroy({ texture: true, textureSource: true });
    } finally {
      warn.mockRestore();
    }

    expect(warn.mock.calls, 'the group holds its sources unwatched, so destroying them warns nothing').toEqual([]);
    expect(group.getResource(0), 'the dropped group still holds the source it was built with').toBe(texture.source);
    expect(texture.destroyed).toBe(true);
    expect(texture.source.destroyed).toBe(true);
    store.destroy();
  });

  it('holds every resource unwatched, so a texture shared by many materials carries no listener per material', () => {
    const store = makeStore();
    const a = makeTexture();
    const shared = [a.source, a.source.style, Texture.WHITE.source, Texture.WHITE.source.style];
    const baseline = shared.map(listeners);

    const materials = Array.from({ length: 1000 }, () => new Material3D({ baseColorTexture: a }));
    for (const material of materials) {
      store.register(material);
      material._getBindGroup();
      material._getMergedBindGroup();
    }
    expect(shared.map(listeners)).toEqual(baseline);

    for (const material of materials) material.destroy();
    expect(shared.map(listeners)).toEqual(baseline);
    a.destroy(true);
    store.destroy();
  });

  it('re-keys only when refreshed after a source moves, and empties a destroyed one', () => {
    const store = makeStore();
    const a = makeTexture();
    const material = new FlatMaterial({ baseColorTexture: a });
    store.register(material);
    const group = material._getBindGroup();
    const merged = material._getMergedBindGroup();
    const key = keyOf(group);
    const mergedKey = keyOf(merged);

    a.source.resize(4, 4);
    expect(keyOf(group), 'nothing re-keys the group on its own').toBe(key);

    material._refreshTextureBindings();
    expect(keyOf(group), 'the refresh re-keys it').not.toBe(key);
    expect(keyOf(merged), 'and the merged group').not.toBe(mergedKey);

    const refreshed = keyOf(group);
    material._refreshTextureBindings();
    expect(keyOf(group), 'a refresh with nothing moved changes nothing').toBe(refreshed);

    a.source.destroy();
    material._refreshTextureBindings();
    expect(group.getResource(0), 'a destroyed source leaves its slot empty').toBeNull();
    expect(merged.getResource(0)).toBeNull();

    material.destroy();
    store.destroy();
  });
});
