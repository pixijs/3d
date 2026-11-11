/**
 * Building a 100,000-slot `BatchedMesh3D`, timed in Node, with its heap cost per build read as alloc/op.
 * Every slot is created up front in the batch's constructor and keeps a per-pass cache for its whole life, so what
 * one slot holds is paid 100,000 times, and phone tiers are sized by how much JS heap a scene keeps.
 *
 * A sample builds the batch, gives every slot the two pass-cache entries a shadow-casting opaque slot carries
 * (SHADOW and OPAQUE, bits 1 and 2), and destroys it. The entries share one object, so the cost read is the cache's
 * own storage, not the entries'.
 */

import { BatchedMesh3D } from '@pixi/3d';
import type { MeshPassCache } from '@pixi/3d';
import { cpu } from 'benchy';

const SLOTS = 100_000;
const SHADOW = 1;
const OPAQUE = 2;

cpu('build a 100k-slot batched mesh', function* () {
  const entry = {} as MeshPassCache;
  let filled = 0;
  yield {
    bench: () => {
      const batched = new BatchedMesh3D({ size: SLOTS });
      const items = batched.batch.items;
      let count = 0;
      for (let i = 0; i < items.length; i++) {
        const cache = items[i]._passCache;
        cache[SHADOW] = entry;
        cache[OPAQUE] = entry;
        count += 2;
      }
      batched.destroy();
      filled = count;
      return count;
    },
    snapshot: () => filled,
  };
});
