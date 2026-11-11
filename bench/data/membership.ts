import { BatchedMesh3D, CubeGeometry, Material3D, Matrix4, Mesh3D, RenderPassBit } from '@pixi/3d';
import type { CullMode } from '@pixi/3d';
import type { FrameScene } from 'benchy';

import type { PixiStage } from '../stage.ts';
import { MembershipPass } from './MembershipPass.ts';
import { rng } from './rng.ts';

type PairOptions = {
  count: number;
  births: number;
  kinds?: number;
  mismatch?: number;
  distribution?: 'contiguous' | 'clustered' | 'scattered';
  objects?: boolean;
  cache?: 'auto' | 'never';
  passes?: number;
  capacity?: number;
  highRows?: boolean;
  readopt?: boolean;
  cull?: CullMode;
  churn?: boolean;
  pairShift?: number;
};

/** A fixed grid keeps membership work visible without overlapping surfaces or camera motion. */
export function frameMembershipGrid(stage: PixiStage): void {
  stage.view.camera.position.set(0, 0, 32);
  stage.view.camera.lookAt({ x: 0, y: 0, z: 0 });
  stage.view.camera.fov = 45;
  stage.view.camera.near = 0.1;
  stage.view.camera.far = 100;
}

/**
 * Two resident slots or pooled objects per visible object. Odd steps switch a rolling block to
 * its partners; even steps restore it. A clock restart can change at most one block, not the scene.
 * Arithmetic and the change list live in simulate; update contains only the requested engine calls.
 */
export function createMembershipPairs(stage: PixiStage, options: PairOptions): FrameScene {
  const anchorKind = options.mismatch !== undefined;
  const {
    count,
    births,
    kinds = 1,
    mismatch = 0,
    distribution = 'contiguous',
    objects = false,
    cache,
    passes = 1,
    capacity = count * passes * 2 + (anchorKind ? 1 : 0),
    highRows = false,
    readopt = false,
    cull = 'cpu',
    churn = true,
    pairShift = 0.12,
  } = options;
  if (count % births !== 0 || capacity < count * passes * 2 + (anchorKind ? 1 : 0) || mismatch > births) {
    throw new Error('Membership pairs require whole edit blocks, enough slots, and mismatch <= births.');
  }
  frameMembershipGrid(stage);
  stage.view.cull = cull;
  const customPasses = cache
    ? Array.from({ length: passes }, (_, i) => new MembershipPass(`membership-${i}`, cache))
    : [];
  stage.view.passes = customPasses;
  const bits = customPasses.length ? customPasses.map((pass) => pass.bit) : [RenderPassBit.OPAQUE];
  const material = new Material3D({ baseColor: 0x62b9dc, roughness: 0.8 });
  // Different identities force different geometry commands, even on WebGL's merged-material path.
  const geometries = Array.from({ length: kinds + (anchorKind ? 1 : 0) }, () => new CubeGeometry());
  const batch = objects ? null : new BatchedMesh3D({ size: capacity, cull });
  const meshes: Mesh3D[] = [];
  const total = count * passes;
  const firstRow = highRows ? capacity - total * 2 - (anchorKind ? 1 : 0) : 0;
  const slots = new Uint32Array(total * 2);
  const order = Uint32Array.from({ length: count }, (_, i) => i);
  const random = rng(0x51a7);
  if (distribution === 'scattered') {
    for (let i = count - 1; i > 0; i--) {
      const j = random.int(i + 1);
      const value = order[i];
      order[i] = order[j];
      order[j] = value;
    }
  } else if (distribution === 'clustered') {
    // Ten consecutive rows in each cluster; successive clusters visit distant parts of the grid.
    const clusters = count / 10;
    for (let i = 0; i < count; i++) order[i] = ((Math.floor(i / 10) * 97) % clusters) * 10 + (i % 10);
    if (new Set(order).size !== count) throw new Error('Cluster stride must be coprime to the cluster count.');
  }
  const rank = new Uint32Array(count);
  for (let i = 0; i < count; i++) rank[order[i]] = i;
  const columns = Math.ceil(Math.sqrt(total * 1.8));
  const rows = Math.ceil(total / columns);
  const cell = Math.min(34 / columns, 18 / rows);
  const matrix = new Matrix4();
  for (let pass = 0; pass < passes; pass++) {
    for (let pool = 0; pool < 2; pool++) {
      for (let i = 0; i < count; i++) {
        const pair = pass * count + i;
        const id = pool * total + pair;
        const slot = firstRow + pass * count * 2 + pool * count + i;
        slots[id] = slot;
        const geometry = geometries[pool === 1 && rank[i] % births < mismatch ? kinds : i % kinds];
        const x = ((pair % columns) - (columns - 1) / 2 + (pool ? pairShift : -pairShift)) * cell;
        const y = ((rows - 1) / 2 - Math.floor(pair / columns)) * cell;
        const size = cell * 0.45;
        if (batch) {
          matrix.fromArray([size, 0, 0, 0, 0, size, 0, 0, 0, 0, size, 0, x, y, 0, 1]);
          batch.setGeometryAt(slot, geometry);
          batch.setMaterialAt(slot, material);
          batch.setMatrixAt(slot, matrix);
          batch.setPassesAt(slot, bits[pass]);
        } else {
          const mesh = new Mesh3D({ geometry, material });
          mesh.position.set(x, y, 0);
          mesh.scale.set(size, size, size);
          meshes[id] = mesh;
          stage.view.root.addChild(mesh);
        }
      }
    }
  }
  if (batch) {
    if (anchorKind) {
      // Keep the destination command alive, even in the zero-mismatch control.
      matrix.fromArray([cell / 2, 0, 0, 0, 0, cell / 2, 0, 0, 0, 0, cell / 2, 0, 0, -10, 0, 1]);
      batch.setGeometryAt(capacity - 1, geometries[kinds]);
      batch.setMaterialAt(capacity - 1, material);
      batch.setMatrixAt(capacity - 1, matrix);
      batch.setPassesAt(capacity - 1, bits[0]);
    }
    stage.view.root.addChild(batch);
  }
  // Prime both pools' resources outside measurement, then build only pool zero into the body.
  stage.renderer.render({ container: stage.view.parent ?? stage.view });
  for (let pair = 0; pair < total; pair++) {
    if (batch) batch.setPassesAt(slots[total + pair], 0);
    else stage.view.root.removeChild(meshes[total + pair]);
  }
  stage.view._invalidateDrawCaches();
  stage.renderer.render({ container: stage.view.parent ?? stage.view });

  const live = new Uint8Array(total);
  const departures = new Uint32Array(total);
  const arrivals = new Uint32Array(total);
  let changed = 0;
  let invalidate = false;
  return {
    simulate(seconds) {
      const frameIndex = Math.round(seconds * 60);
      const step = readopt ? Math.ceil(frameIndex / 2) : frameIndex;
      const blocks = count / births;
      const block = Math.floor(step / 2) % blocks;
      changed = 0;
      invalidate = readopt && frameIndex % 2 === 0;
      for (let pass = 0; pass < passes; pass++) {
        for (let i = 0; i < count; i++) {
          const pair = pass * count + i;
          const wanted = churn && step % 2 === 1 && Math.floor(rank[i] / births) === block ? 1 : 0;
          if (live[pair] === wanted) continue;
          departures[changed] = live[pair] * total + pair;
          arrivals[changed++] = wanted * total + pair;
          live[pair] = wanted;
        }
      }
    },
    update() {
      // Retire the whole edit block before adding its replacements, including 100% turnover.
      if (batch) {
        for (let i = 0; i < changed; i++) batch.setPassesAt(slots[departures[i]], 0);
        for (let i = 0; i < changed; i++) {
          const id = arrivals[i];
          batch.setPassesAt(slots[id], bits[Math.floor((id % total) / count)]);
        }
      } else {
        for (let i = 0; i < changed; i++) stage.view.root.removeChild(meshes[departures[i]]);
        for (let i = 0; i < changed; i++) stage.view.root.addChild(meshes[arrivals[i]]);
      }
      if (invalidate) stage.view._invalidateDrawCaches();
    },
    destroy() {
      // Detached pool members are not owned by the stage; destroy is idempotent for the others.
      for (const mesh of meshes) mesh.destroy();
      for (const pass of customPasses) pass.destroy();
      for (const geometry of geometries) geometry.destroy(true);
      material.destroy(true);
    },
  };
}
