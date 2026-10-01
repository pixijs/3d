import { describe, expect, it } from 'vitest';

import { MATERIAL_STRIDE_FLOATS, MaterialDataStoreBuffer } from '~/core/buffers/MaterialDataStoreBuffer';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { PhongMaterial } from '~/materials/phong/PhongMaterial';

function row(store: MaterialDataStoreBuffer, material: BaseMaterial3D): number[] {
  const offset = material._materialIndex * MATERIAL_STRIDE_FLOATS;
  return Array.from(store.data.slice(offset, offset + MATERIAL_STRIDE_FLOATS));
}

describe('MaterialDataStoreBuffer upload queue', () => {
  it('mints the index at register and uploads all data through update', () => {
    const store = new MaterialDataStoreBuffer();
    const material = new FlatMaterial({ baseColor: 0xff0000 });

    store.register(material);
    expect(material._uploadQueue).toBe(store);
    expect(material._materialIndex).toBeGreaterThanOrEqual(0);
    expect(material._storeQueued).toBe(true);

    store.update();
    expect(material._storeQueued).toBe(false);
    expect(row(store, material)).toEqual(Array.from(material.data._f32));

    material.baseColor = 0x00ff00;
    expect(material._storeQueued).toBe(true);

    store.update();
    expect(material._storeQueued).toBe(false);
    expect(row(store, material)).toEqual(Array.from(material.data._f32));
  });

  it('coalesces repeat writes into one queue entry and ignores a re-register', () => {
    const store = new MaterialDataStoreBuffer();
    const material = new FlatMaterial({});
    store.register(material);
    store.update();

    material.alpha = 0.5;
    material.baseColor = 0x123456;
    store.register(material);

    store.update();
    expect(material._storeQueued).toBe(false);
    expect(row(store, material)).toEqual(Array.from(material.data._f32));
  });

  it('uploads a hand-rolled setter, which writes a packed view in place and has to call update() itself', () => {
    const store = new MaterialDataStoreBuffer();
    const material = new PhongMaterial({ specularColor: 0x000000 });

    store.register(material);
    store.update();
    expect(material._storeQueued).toBe(false);

    material.specularColor = 0xff0000;
    expect(material._storeQueued).toBe(true);

    store.update();
    expect(row(store, material)).toEqual(Array.from(material.data._f32));
  });

  it('carries pre-registration mutations into the first update', () => {
    const store = new MaterialDataStoreBuffer();
    const material = new FlatMaterial({});

    material.baseColor = 0xabcdef;
    expect(material._storeQueued).toBe(false);

    store.register(material);
    store.update();

    expect(row(store, material)).toEqual(Array.from(material.data._f32));
  });

  it('skips a material destroyed while queued and keeps draining', () => {
    const store = new MaterialDataStoreBuffer();
    const doomed = new FlatMaterial({});
    const survivor = new FlatMaterial({});

    store.register(doomed);
    store.register(survivor);
    store.update();

    doomed.baseColor = 0xff0000;
    survivor.baseColor = 0x123456;
    doomed.destroy();

    expect(() => store.update()).not.toThrow();
    expect(doomed._storeQueued).toBe(false);
    expect(survivor._storeQueued).toBe(false);
    expect(row(store, survivor)).toEqual(Array.from(survivor.data._f32));

    doomed.update();
    expect(doomed._storeQueued).toBe(false);

    survivor.baseColor = 0xabcdef;
    store.update();
    expect(row(store, survivor)).toEqual(Array.from(survivor.data._f32));
  });

  it('material destroy releases its slot for the next registered material', () => {
    const store = new MaterialDataStoreBuffer();
    const doomed = new FlatMaterial({});
    store.register(doomed);
    store.update();
    const slot = doomed._materialIndex;

    doomed.destroy();
    expect(doomed._materialIndex).toBe(-1);

    const next = new FlatMaterial({});
    store.register(next);
    expect(next._materialIndex).toBe(slot);
  });

  it('a material minted by a destroyed store re-mints lazily in a fresh store, not adopting its stale row', () => {
    const store = new MaterialDataStoreBuffer();
    const material = new FlatMaterial({});
    store.register(material);
    store.update();

    store.destroy();

    material.baseColor = 0xff0000;
    expect(material._storeQueued).toBe(false);

    const fresh = new MaterialDataStoreBuffer();
    const resident = new FlatMaterial({});
    fresh.register(resident);
    fresh.register(material);
    expect(material._uploadQueue).toBe(fresh);
    expect(material._materialIndex).not.toBe(resident._materialIndex);

    fresh.update();
    expect(material._storeQueued).toBe(false);
    expect(row(fresh, material)).toEqual(Array.from(material.data._f32));
  });

  it('a material still queued when its store died re-mints cleanly', () => {
    const store = new MaterialDataStoreBuffer();
    const material = new FlatMaterial({});
    store.register(material);
    store.update();

    material.baseColor = 0xff0000;
    store.destroy();

    const fresh = new MaterialDataStoreBuffer();
    fresh.register(material);
    fresh.update();
    expect(material._storeQueued).toBe(false);
    expect(row(fresh, material)).toEqual(Array.from(material.data._f32));
  });

  it('a material moving between live stores gets a fresh row instead of the foreign slot, and destroy frees it', () => {
    const storeA = new MaterialDataStoreBuffer();
    const storeB = new MaterialDataStoreBuffer();
    const material = new FlatMaterial({});
    const resident = new FlatMaterial({});

    storeA.register(material);
    storeB.register(resident);
    storeB.register(material);
    expect(material._uploadQueue).toBe(storeB);
    expect(material._materialIndex).toBe(1);

    material.destroy();
    const next = new FlatMaterial({});
    storeB.register(next);
    expect(next._materialIndex).toBe(1);
  });

  it('material destroy after its store died is safe and resets the index', () => {
    const store = new MaterialDataStoreBuffer();
    const material = new FlatMaterial({});
    store.register(material);
    store.destroy();

    expect(() => material.destroy()).not.toThrow();
    expect(material._materialIndex).toBe(-1);
  });
});

/** A value a float32 struct slot can't hold exactly: it reads back as 0.30000001192092896 */
const INEXACT_IN_FLOAT32 = 0.3;

describe('re-setting a value the material already holds, as per-frame animation code does', () => {
  function drain(material: BaseMaterial3D): void {
    const store = new MaterialDataStoreBuffer();
    store.register(material);
    store.update();
  }

  it('queues nothing for an inexact float scalar', () => {
    const material = new Material3D({});
    material.normalScale = INEXACT_IN_FLOAT32;
    drain(material);

    material.normalScale = INEXACT_IN_FLOAT32;
    expect(material._storeQueued).toBe(false);
  });

  it('queues nothing for an inexact float lane of a feature group', () => {
    const material = new Material3D({ clearcoat: {} });
    material.clearcoat!.roughness = INEXACT_IN_FLOAT32;
    drain(material);

    material.clearcoat!.roughness = INEXACT_IN_FLOAT32;
    expect(material._storeQueued).toBe(false);
  });

  it.each(['metallic', 'roughness', 'occlusionStrength', 'ior'] as const)(
    'queues nothing for an inexact %s',
    (prop) => {
      const material = new Material3D({});
      material[prop] = INEXACT_IN_FLOAT32;
      drain(material);

      material[prop] = INEXACT_IN_FLOAT32;
      expect(material._storeQueued).toBe(false);
    },
  );

  it('still queues a change to an integer field that float32 would round away', () => {
    const bit: ShaderBit = { name: 'flags', bindings: { material: { flags: 'u32' } } };
    const material = new BaseMaterial3D({ descriptor: { bitsGpu: [bit], bitsGl: [bit] } });
    material.data.flags = 0xffff0000;
    drain(material);

    material.data.flags = 0xffff0001;
    expect(material._storeQueued).toBe(true);
    expect(material.data.flags).toBe(0xffff0001);
  });
});
