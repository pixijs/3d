import { captureWarnings } from '@test-utils';
import { describe, expect, it, vi } from 'vitest';

import { MorphStoreBuffer } from '~/core/buffers/MorphStoreBuffer';
import type { Geometry3D } from '~/geometry/Geometry3D';
import type { Mesh3D } from '~/scene/Mesh3D';
import { Morph } from '~/scene/Morph';

/** `uid` is the identity a store's warning names */
const morphedGeometry = (vertexCount: number, targetCount = 1, uid = 0): Geometry3D => {
  const targets: { positions: Float32Array }[] = [];
  for (let i = 0; i < targetCount; i++) targets.push({ positions: new Float32Array(vertexCount * 3) });
  return {
    uid,
    _morphDeltaBase: -1,
    _morphDeltaFloats: 0,
    _morphStore: null,
    _morphTargets: targets,
  } as unknown as Geometry3D;
};

const morphedMesh = (weightCount: number): Morph => new Morph(new Float32Array(weightCount));

/** The store's per-bucket free lists, reached past `private` */
interface FreeLists {
  _freeSlots: Map<number, number[]>;
  _freeDeltaBlocks: Map<number, number[]>;
}

const total = (lists: Map<number, number[]>): number => {
  let n = 0;
  for (const list of lists.values()) n += list.length;
  return n;
};

/**
 * Runs `fn`, swallowing the warning a geometry packed by another store raises, for tests about
 * something else
 * @param fn - The calls that may warn
 */
const ignoringRepackWarning = (fn: () => void): void => void captureWarnings(fn);

const freeSlotCount = (store: MorphStoreBuffer): number => total((store as unknown as FreeLists)._freeSlots);
const freeDeltaBlockCount = (store: MorphStoreBuffer): number =>
  total((store as unknown as FreeLists)._freeDeltaBlocks);
/** Absolute float offset where the weight-slot region starts (the arena's reservation) */
const weightsBase = (store: MorphStoreBuffer): number =>
  (store as unknown as { _deltaCapacity: number })._deltaCapacity;

/** The slice of a Mesh3D that `sync` reads: a morphed geometry, the morph state, and the row-dirty flag */
const syncable = (weights: number[]): Mesh3D =>
  ({
    geometry: morphedGeometry(1, weights.length),
    morph: new Morph(new Float32Array(weights)),
    _storeDirty: false,
  }) as unknown as Mesh3D;

describe('MorphStoreBuffer', () => {
  it('keeps grown-away buffers alive for in-flight bundles and frees them on destroy', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 64, weightCapacity: 8 });
    const first = store.buffer;

    store.uploadDeltas(morphedGeometry(128));

    expect(store.buffer, '512 floats of deltas outgrow the 64-float arena').not.toBe(first);
    expect(first.destroyed, 'replaced, not destroyed: bundles recorded with it may still be in flight').toBe(false);

    store.destroy();
    expect(first.destroyed, 'the GC never frees a retired buffer, so destroy has to').toBe(true);
  });

  it('freeDeltas recycles a freed block for the next same-extent pack', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 1024, weightCapacity: 8 });
    const first = morphedGeometry(4, 2);
    store.uploadDeltas(first);
    const base = first._morphDeltaBase;
    expect(first._morphStore).toBe(store);
    expect(first._morphDeltaFloats).toBe(32);

    store.freeDeltas(first);
    expect(first._morphDeltaBase).toBe(-1);
    expect(first._morphStore).toBeNull();

    const second = morphedGeometry(4, 2);
    store.uploadDeltas(second);
    expect(second._morphDeltaBase, 'the same size reuses the freed block').toBe(base);

    const third = morphedGeometry(4, 2);
    store.uploadDeltas(third);
    expect(third._morphDeltaBase, 'with the free list empty, the next block goes after it').toBe(base + 32);
  });

  it('same-asset churn reuses one recycled block — the arena never grows', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 64, weightCapacity: 8 });

    for (let i = 0; i < 32; i++) {
      const geometry = morphedGeometry(4);
      store.uploadDeltas(geometry);
      store.freeDeltas(geometry);
    }
    expect(store.bufferVersion, 'without recycling, 32 blocks of 16 floats would outgrow the 64-float arena').toBe(0);
  });

  it('a geometry packed by a destroyed store reads as unpacked in a fresh store', () => {
    const storeA = new MorphStoreBuffer({ deltaCapacity: 1024, weightCapacity: 8 });
    const geometry = morphedGeometry(4, 1, 987654);
    storeA.uploadDeltas(geometry);
    expect(geometry._morphDeltaBase).toBeGreaterThanOrEqual(0);
    storeA.destroy();

    const storeB = new MorphStoreBuffer({ deltaCapacity: 1024, weightCapacity: 8 });
    const fresh = morphedGeometry(4);
    const warnings = captureWarnings(() => {
      storeB.uploadDeltas(geometry);
      expect(
        geometry._morphDeltaBase,
        "its raw targets went at pack, so it resets and draws unmorphed rather than use the dead store's offset",
      ).toBe(-1);
      expect(geometry._morphStore).toBeNull();

      storeB.uploadDeltas(fresh);
      expect(fresh._morphDeltaBase, 'nothing was reserved for the survivor').toBe(0);
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('987654');
  });

  it('a geometry packed by a live store hands its block back there when another store sees it', () => {
    const storeA = new MorphStoreBuffer({ deltaCapacity: 1024, weightCapacity: 8 });
    const storeB = new MorphStoreBuffer({ deltaCapacity: 1024, weightCapacity: 8 });
    const geometry = morphedGeometry(4, 2, 987654);
    storeA.uploadDeltas(geometry);
    expect(freeDeltaBlockCount(storeA)).toBe(0);

    const warnings = captureWarnings(() => storeB.uploadDeltas(geometry));

    expect(freeDeltaBlockCount(storeA)).toBe(1);
    expect(geometry._morphDeltaBase).toBe(-1);
    expect(geometry._morphStore).toBeNull();
    expect(freeDeltaBlockCount(storeB)).toBe(0);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('987654');
    expect(warnings[0]).toContain('unmorphed');
  });

  it('a geometry never packed anywhere packs silently', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 1024, weightCapacity: 8 });
    const geometry = morphedGeometry(4, 2, 987654);

    const warnings = captureWarnings(() => store.uploadDeltas(geometry));

    expect(warnings).toHaveLength(0);
    expect(geometry._morphStore).toBe(store);
    expect(geometry._morphDeltaBase).toBe(0);
  });

  it('a morph synced by a second store hands its slot back to the first', () => {
    const storeA = new MorphStoreBuffer({ deltaCapacity: 64, weightCapacity: 64 });
    const storeB = new MorphStoreBuffer({ deltaCapacity: 64, weightCapacity: 64 });
    const mesh = syncable([1, 0]);
    const morph = mesh.morph!;

    storeA.sync([mesh]);
    expect(morph._store).toBe(storeA);
    expect(freeSlotCount(storeA)).toBe(0);

    ignoringRepackWarning(() => storeB.sync([mesh]));

    expect(morph._store).toBe(storeB);
    expect(morph._slot).toBeGreaterThanOrEqual(0);
    expect(freeSlotCount(storeA)).toBe(1);
    expect(freeSlotCount(storeB)).toBe(0);
  });

  it('weight slots minted by a destroyed store re-mint in a fresh store without aliasing', () => {
    const storeA = new MorphStoreBuffer({ deltaCapacity: 64, weightCapacity: 64 });
    const survivors = [syncable([1, 0]), syncable([0, 1])];
    storeA.sync(survivors);
    storeA.destroy();

    const storeB = new MorphStoreBuffer({ deltaCapacity: 64, weightCapacity: 64 });
    const meshes = [syncable([0.5, 0.5]), ...survivors];
    storeB.sync(meshes);

    expect(
      new Set(meshes.map((mesh) => mesh.morph!._slot)).size,
      'the fresh store hands out the slot numbers the survivors still carry to the mesh synced first',
    ).toBe(meshes.length);
    for (const { morph } of meshes) {
      expect(morph!._store).toBe(storeB);
      expect(morph!._weightIndex).toBe(weightsBase(storeB) + morph!._slot);
      const slot = storeB.data.subarray(morph!._weightIndex, morph!._weightIndex + 2);
      expect(Array.from(slot)).toEqual(Array.from(morph!.weights));
    }

    const upload = vi.spyOn(storeB.buffer, 'update');
    storeB.sync(meshes);
    expect(upload, 'no two meshes share a slot, so the next sync uploads nothing').not.toHaveBeenCalled();
  });

  it('freeDeltas after store destroy resets the geometry without touching dead state', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 64, weightCapacity: 8 });
    const geometry = morphedGeometry(4);
    store.uploadDeltas(geometry);

    store.destroy();
    expect(() => store.freeDeltas(geometry)).not.toThrow();
    expect(geometry._morphDeltaBase).toBe(-1);
  });

  it('freeSlot after store destroy resets the morph without touching dead state', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 64, weightCapacity: 64 });
    const mesh = syncable([1, 0]);
    store.sync([mesh]);
    const morph = mesh.morph!;
    expect(morph._slot).toBeGreaterThanOrEqual(0);

    store.destroy();
    expect(() => store.freeSlot(morph)).not.toThrow();
    expect(morph._slot).toBe(-1);
    expect(morph._slotSize).toBe(0);
    expect(morph._store).toBeNull();
    expect(freeSlotCount(store), 'a dead store recycles nothing').toBe(0);
  });

  it('packs new geometries within the arena reservation without moving the weights base', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 1024, weightCapacity: 8 });
    const base = weightsBase(store);

    store.uploadDeltas(morphedGeometry(3, 2));
    expect(weightsBase(store), '24 floats fit the reservation').toBe(base);
    expect(store.bufferVersion).toBe(0);
  });

  it('arena growth shifts the weights base, preserving slots and their packed values', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 64, weightCapacity: 16 });

    const mesh = morphedMesh(4);
    mesh.weights!.set([0.1, 0.2, 0.3, 0.4]);
    store.allocSlot(mesh);
    store.writeWeights(mesh);
    const slot = mesh._slot;

    store.uploadDeltas(morphedGeometry(128));

    expect(weightsBase(store), '512 floats of deltas double the 64-float arena to 512').toBe(512);
    expect(mesh._slot, 'slots are relative to the weights base, so the move leaves them alone').toBe(slot);
    const absolute = weightsBase(store) + slot;
    expect(Array.from(store.data.subarray(absolute, absolute + 4))).toEqual([
      expect.closeTo(0.1),
      expect.closeTo(0.2),
      expect.closeTo(0.3),
      expect.closeTo(0.4),
    ]);
  });

  it('packs position+normal texel pairs when the geometry has normal deltas', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 256, weightCapacity: 8 });

    /** One vertex, two targets, a distinct value in every lane */
    const geometry = {
      _morphDeltaBase: -1,
      hasMorphNormals: true,
      _morphTargets: [
        { positions: new Float32Array([1, 2, 3]), normals: new Float32Array([4, 5, 6]) },
        { positions: new Float32Array([7, 8, 9]), normals: new Float32Array([10, 11, 12]) },
      ],
    } as unknown as Geometry3D;

    store.uploadDeltas(geometry);

    expect(geometry._morphDeltaBase).toBe(0);
    expect(
      Array.from(store.data.subarray(0, 16)),
      'stride 8: a position then a normal texel per target, each xyz and a pad',
    ).toEqual([1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0, 10, 11, 12, 0]);

    const plain = morphedGeometry(1);
    store.uploadDeltas(plain);
    expect(plain._morphDeltaBase, 'a positions-only geometry packs after it at stride 4').toBe(16);
  });

  it('computes the conservative bounds expansion while packing', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 256, weightCapacity: 8 });

    /** Two targets whose longest deltas are 4 and 3 */
    const geometry = {
      _morphDeltaBase: -1,
      _morphTargets: [
        { positions: new Float32Array([3, 0, 0, 0, 4, 0]) },
        { positions: new Float32Array([0, 0, 1, 2, 2, 1]) },
      ],
    } as unknown as Geometry3D;

    store.uploadDeltas(geometry);

    expect(
      geometry._morphBoundsExpansion,
      "the sum of each target's longest delta bounds any vertex for weights in [0, 1]",
    ).toBeCloseTo(7);
  });

  it('recycles freed slots within the same power-of-two bucket', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 16, weightCapacity: 64 });

    const meshA = morphedMesh(4);
    store.allocSlot(meshA);
    const slotA = meshA._slot;

    store.freeSlot(meshA);
    expect(meshA._slot).toBe(-1);
    expect(meshA._store).toBeNull();

    const meshB = morphedMesh(3);
    store.allocSlot(meshB);
    expect(meshB._slot, "3 weights round up to A's size of 4 and reuse its slot").toBe(slotA);

    const meshC = morphedMesh(5);
    store.allocSlot(meshC);
    expect(meshC._slot, '5 weights need a slot of 8').not.toBe(slotA);
  });

  it('weight-region growth keeps the base and existing slots in place', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 16, weightCapacity: 4 });

    const meshA = morphedMesh(4);
    store.allocSlot(meshA);
    expect(meshA._slot).toBe(0);

    const meshB = morphedMesh(4);
    store.allocSlot(meshB);

    expect(store.bufferVersion, 'a second slot of 4 outgrows the 4-float region, which doubles').toBe(1);
    expect(weightsBase(store)).toBe(16);
    expect(meshA._slot).toBe(0);
    expect(meshB._slot).toBe(4);
  });
});
