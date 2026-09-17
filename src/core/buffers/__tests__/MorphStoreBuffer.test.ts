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

    // 128 verts × 1 target × 4 floats = 512 > 64 → the delta arena grows.
    store.uploadDeltas(morphedGeometry(128));

    // The old buffer is replaced, not destroyed — render bundles recorded
    // against it earlier in the frame may still be in flight.
    expect(store.buffer).not.toBe(first);
    expect(first.destroyed).toBe(false);

    // destroy() must free the retired buffer too: autoGarbageCollect is off,
    // so nothing else ever reclaims it.
    store.destroy();
    expect(first.destroyed).toBe(true);
  });

  it('freeDeltas recycles a freed block for the next same-extent pack', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 1024, weightCapacity: 8 });
    const first = morphedGeometry(4, 2); // 4 verts × 2 targets × 4 floats = 32
    store.uploadDeltas(first);
    const base = first._morphDeltaBase;
    expect(first._morphStore).toBe(store);
    expect(first._morphDeltaFloats).toBe(32);

    store.freeDeltas(first);
    expect(first._morphDeltaBase).toBe(-1);
    expect(first._morphStore).toBeNull();

    const second = morphedGeometry(4, 2); // same extent → reuses the freed block
    store.uploadDeltas(second);
    expect(second._morphDeltaBase).toBe(base);

    const third = morphedGeometry(4, 2); // free list drained → bump-allocated after it
    store.uploadDeltas(third);
    expect(third._morphDeltaBase).toBe(base + 32);
  });

  it('same-asset churn reuses one recycled block — the arena never grows', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 64, weightCapacity: 8 });

    // 4 verts × 1 target × 4 floats = 16 ≤ 64. Without recycling, 32 packs
    // would bump 512 floats and force arena growth; with it, one block cycles.
    for (let i = 0; i < 32; i++) {
      const geometry = morphedGeometry(4);
      store.uploadDeltas(geometry);
      store.freeDeltas(geometry);
    }
    expect(store.bufferVersion).toBe(0);
  });

  // The store is renderer-scoped; geometries and morphs are user-owned and
  // outlive it. Survivors carry the dead store's offsets until the next
  // renderer's store sees them.
  it('a geometry packed by a destroyed store reads as unpacked in a fresh store', () => {
    const storeA = new MorphStoreBuffer({ deltaCapacity: 1024, weightCapacity: 8 });
    const geometry = morphedGeometry(4, 1, 987654);
    storeA.uploadDeltas(geometry);
    expect(geometry._morphDeltaBase).toBeGreaterThanOrEqual(0);
    storeA.destroy();

    // The raw targets went at pack, so the survivor can't re-pack: the fresh
    // store resets it (it renders unmorphed there) rather than baking the dead
    // store's arena offset into its rows, and says so once, naming the geometry.
    const storeB = new MorphStoreBuffer({ deltaCapacity: 1024, weightCapacity: 8 });
    const fresh = morphedGeometry(4);
    const warnings = captureWarnings(() => {
      storeB.uploadDeltas(geometry);
      expect(geometry._morphDeltaBase).toBe(-1);
      expect(geometry._morphStore).toBeNull();

      // Nothing was reserved for it: the next real pack starts at the arena's base.
      storeB.uploadDeltas(fresh);
      expect(fresh._morphDeltaBase).toBe(0);
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('987654');
  });

  // The old store may still be alive (two renderers in one page, the first not
  // yet destroyed): the block goes back to it before the geometry is reset.
  it('a geometry packed by a live store hands its block back there when another store sees it', () => {
    const storeA = new MorphStoreBuffer({ deltaCapacity: 1024, weightCapacity: 8 });
    const storeB = new MorphStoreBuffer({ deltaCapacity: 1024, weightCapacity: 8 });
    const geometry = morphedGeometry(4, 2, 987654); // 32 floats
    storeA.uploadDeltas(geometry);
    expect(freeDeltaBlockCount(storeA)).toBe(0);

    const warnings = captureWarnings(() => storeB.uploadDeltas(geometry));

    expect(freeDeltaBlockCount(storeA)).toBe(1);
    expect(geometry._morphDeltaBase).toBe(-1);
    expect(geometry._morphStore).toBeNull();
    expect(freeDeltaBlockCount(storeB)).toBe(0);

    // One warning, naming the geometry, saying it draws unmorphed here.
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

    // The fake geometry's targets went at A's pack, so B also warns about it; not this test's subject.
    captureWarnings(() => storeB.sync([mesh]));

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

    // The fresh store hands its first slots out again — the numbers the
    // survivors still carry — so a resident synced ahead of them would collide.
    const storeB = new MorphStoreBuffer({ deltaCapacity: 64, weightCapacity: 64 });
    const meshes = [syncable([0.5, 0.5]), ...survivors];
    storeB.sync(meshes);

    expect(new Set(meshes.map((mesh) => mesh.morph!._slot)).size).toBe(meshes.length);
    for (const { morph } of meshes) {
      expect(morph!._store).toBe(storeB);
      expect(morph!._weightIndex).toBe(weightsBase(storeB) + morph!._slot);
      const slot = storeB.data.subarray(morph!._weightIndex, morph!._weightIndex + 2);
      expect(Array.from(slot)).toEqual(Array.from(morph!.weights));
    }

    // Settled: no two meshes fight over a run, so the next sync uploads nothing.
    const upload = vi.spyOn(storeB.buffer, 'update');
    storeB.sync(meshes);
    expect(upload).not.toHaveBeenCalled();
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
    // Nothing left to recycle into: the dead store's free lists stay empty.
    expect(freeSlotCount(store)).toBe(0);
  });

  it('packs new geometries within the arena reservation without moving the weights base', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 1024, weightCapacity: 8 });
    const base = weightsBase(store);

    store.uploadDeltas(morphedGeometry(3, 2)); // 24 floats — fits the reservation
    expect(weightsBase(store)).toBe(base);
    expect(store.bufferVersion).toBe(0);
  });

  it('arena growth shifts the weights base, preserving slots and their packed values', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 64, weightCapacity: 16 });

    const mesh = morphedMesh(4);
    mesh.weights!.set([0.1, 0.2, 0.3, 0.4]);
    store.allocSlot(mesh);
    store.writeWeights(mesh);
    const slot = mesh._slot;

    store.uploadDeltas(morphedGeometry(128)); // 512 floats > 64 → arena doubles to 512

    expect(weightsBase(store)).toBe(512);
    expect(mesh._slot).toBe(slot); // slots are relative — untouched by the move
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

    // One vertex, two targets, distinct values per lane.
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
    // Stride 8: [pos t0][nrm t0][pos t1][nrm t1], each texel xyz + pad.
    expect(Array.from(store.data.subarray(0, 16))).toEqual([1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0, 10, 11, 12, 0]);

    // A positions-only geometry packs after it at stride 4, unaffected.
    const plain = morphedGeometry(1);
    store.uploadDeltas(plain);
    expect(plain._morphDeltaBase).toBe(16);
  });

  it('computes the conservative bounds expansion while packing', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 256, weightCapacity: 8 });

    const geometry = {
      _morphDeltaBase: -1,
      _morphTargets: [
        { positions: new Float32Array([3, 0, 0, 0, 4, 0]) }, // max ‖δ‖ = 4
        { positions: new Float32Array([0, 0, 1, 2, 2, 1]) }, // max ‖δ‖ = 3
      ],
    } as unknown as Geometry3D;

    store.uploadDeltas(geometry);

    // Σ per-target max delta length — a morphing vertex can't move further
    // for weights in [0, 1].
    expect(geometry._morphBoundsExpansion).toBeCloseTo(7);
  });

  it('recycles freed slots within the same power-of-two bucket', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 16, weightCapacity: 64 });

    const meshA = morphedMesh(4);
    store.allocSlot(meshA);
    const slotA = meshA._slot;

    store.freeSlot(meshA);
    expect(meshA._slot).toBe(-1);
    expect(meshA._store).toBeNull();

    // 3 weights round up to the same bucket (4) — the hole is reused.
    const meshB = morphedMesh(3);
    store.allocSlot(meshB);
    expect(meshB._slot).toBe(slotA);

    // 5 weights need bucket 8 — a fresh slot, not A's hole.
    const meshC = morphedMesh(5);
    store.allocSlot(meshC);
    expect(meshC._slot).not.toBe(slotA);
  });

  it('weight-region growth keeps the base and existing slots in place', () => {
    const store = new MorphStoreBuffer({ deltaCapacity: 16, weightCapacity: 4 });

    const meshA = morphedMesh(4);
    store.allocSlot(meshA);
    expect(meshA._slot).toBe(0);

    const meshB = morphedMesh(4);
    store.allocSlot(meshB); // needs 8 floats total → region doubles

    expect(store.bufferVersion).toBe(1);
    expect(weightsBase(store)).toBe(16);
    expect(meshA._slot).toBe(0);
    expect(meshB._slot).toBe(4);
  });
});
