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

// The material store owns the dirty queue in front of its rows: register()
// mints the slot index synchronously (renderable rows read it in the same
// walk) and enqueues; setters signal via material.update(); the store's
// update() drains queued rows into staged memory and uploads. Nothing walks
// renderables or batch items looking for stale materials — so a material
// referenced only by batch slots must still upload.
describe('MaterialDataStoreBuffer upload queue', () => {
  it('mints the index at register and uploads all data through update', () => {
    const store = new MaterialDataStoreBuffer();
    const material = new FlatMaterial({ baseColor: 0xff0000 });

    store.register(material);
    expect(material._uploadQueue).toBe(store);
    expect(material._materialIndex).toBeGreaterThanOrEqual(0); // synchronous — rows consume it this walk
    expect(material._storeQueued).toBe(true); // the data itself rides the queue

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
    material.baseColor = 0x123456; // same frame — coalesced on the queued flag
    store.register(material); // already resident — no-op

    store.update();
    expect(material._storeQueued).toBe(false);
    expect(row(store, material)).toEqual(Array.from(material.data._f32));
  });

  // Most setters are generated and signal the queue for free. A setter that
  // mutates a packed subarray view in place — PhongMaterial.specularColor — has
  // to call update() by hand, so it's the one shape that can silently stop
  // uploading while every other check stays green.
  it('uploads a hand-rolled setter that writes through a packed view', () => {
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

    material.baseColor = 0xabcdef; // no queue yet — update() is a no-op
    expect(material._storeQueued).toBe(false);

    store.register(material); // the unconditional first enqueue captures it
    store.update();

    expect(row(store, material)).toEqual(Array.from(material.data._f32));
  });

  // The queue holds direct references, so a material can be destroyed while an
  // entry for it is still pending (mutate → destroy in one tick — a normal
  // teardown order). The update must skip the corpse, keep draining the rest,
  // and leave the queue healthy for later frames.
  it('skips a material destroyed while queued and keeps draining', () => {
    const store = new MaterialDataStoreBuffer();
    const doomed = new FlatMaterial({});
    const survivor = new FlatMaterial({});

    store.register(doomed);
    store.register(survivor);
    store.update();

    doomed.baseColor = 0xff0000; // queued ahead of the survivor…
    survivor.baseColor = 0x123456;
    doomed.destroy(); // …then destroyed while both entries are pending

    expect(() => store.update()).not.toThrow();
    expect(doomed._storeQueued).toBe(false); // corpse entry closed out
    expect(survivor._storeQueued).toBe(false);
    expect(row(store, survivor)).toEqual(Array.from(survivor.data._f32));

    // Destroy severed the queue seam — late signals can't resurrect it.
    doomed.update();
    expect(doomed._storeQueued).toBe(false);

    // And the queue isn't poisoned: later frames drain normally.
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

    // The freed row is recycled, not appended past — material churn must not
    // grow the store for the renderer's lifetime.
    const next = new FlatMaterial({});
    store.register(next);
    expect(next._materialIndex).toBe(slot);
  });

  // The store is renderer-scoped; materials are user-owned and outlive it. A
  // survivor keeps the dead store's wiring until the next renderer's store sees
  // it, and register() re-mints there instead of adopting the stale row.
  it('a material minted by a destroyed store re-mints lazily in a fresh store', () => {
    const store = new MaterialDataStoreBuffer();
    const material = new FlatMaterial({});
    store.register(material);
    store.update();

    store.destroy();

    // Late signals into the dead seam are inert and never latch the queue flag.
    material.baseColor = 0xff0000;
    expect(material._storeQueued).toBe(false);

    const fresh = new MaterialDataStoreBuffer();
    const resident = new FlatMaterial({});
    fresh.register(resident); // takes the row number the survivor still carries
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

    material.baseColor = 0xff0000; // queued against the store being torn down
    store.destroy();

    const fresh = new MaterialDataStoreBuffer();
    fresh.register(material);
    fresh.update();
    expect(material._storeQueued).toBe(false);
    expect(row(fresh, material)).toEqual(Array.from(material.data._f32));
  });

  it('a material moving between two live stores re-mints instead of adopting the foreign slot', () => {
    const storeA = new MaterialDataStoreBuffer();
    const storeB = new MaterialDataStoreBuffer();
    const material = new FlatMaterial({});
    const resident = new FlatMaterial({});

    storeA.register(material); // minted in A: slot 0
    storeB.register(resident); // B's slot 0 belongs to someone else
    storeB.register(material);
    expect(material._uploadQueue).toBe(storeB);
    expect(material._materialIndex).toBe(1); // B minted its own row — A's slot 0 was never adopted

    // Destroy frees B's row (the back-ref store), never poisoning it with A's index.
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

// Float struct slots store float32, so 0.3 reads back as 0.30000001192092896. Setters run per
// frame from animation code, and re-setting the value a slot already holds must not queue an upload.
describe('re-setting a value the material already holds', () => {
  function drain(material: BaseMaterial3D): void {
    const store = new MaterialDataStoreBuffer();
    store.register(material);
    store.update();
  }

  it('queues nothing for an inexact float scalar', () => {
    const material = new Material3D({});
    material.normalScale = 0.3;
    drain(material);

    material.normalScale = 0.3;
    expect(material._storeQueued).toBe(false);
  });

  it('queues nothing for an inexact float lane of a feature group', () => {
    const material = new Material3D({ clearcoat: {} });
    material.clearcoat!.roughness = 0.3;
    drain(material);

    material.clearcoat!.roughness = 0.3;
    expect(material._storeQueued).toBe(false);
  });

  it.each(['metallic', 'roughness', 'occlusionStrength', 'ior'] as const)(
    'queues nothing for an inexact %s',
    (prop) => {
      const material = new Material3D({});
      material[prop] = 0.3;
      drain(material);

      material[prop] = 0.3;
      expect(material._storeQueued).toBe(false);
    },
  );

  it('still queues a real change to an integer field', () => {
    const bit: ShaderBit = { name: 'flags', bindings: { material: { flags: 'u32' } } };
    const material = new BaseMaterial3D({ descriptor: { bitsGpu: [bit], bitsGl: [bit] } });
    material.data.flags = 0xffff0000;
    drain(material);

    // Both values round to the same float32, so only an exact integer compare sees the change.
    material.data.flags = 0xffff0001;
    expect(material._storeQueued).toBe(true);
    expect(material.data.flags).toBe(0xffff0001);
  });
});
