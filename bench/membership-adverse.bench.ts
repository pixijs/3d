/**
 * Adverse cases for draw-list membership edits: workloads where editing a built list could cost
 * more than rebuilding it. Each scene renders both pools once untimed, so first-use compilation and
 * allocation stay out of the window, and every edit block is followed by the block that restores it.
 *
 * - `material burst`: 1,024 resident instances, then 8, 32 or 64 new materials of 8 instances
 *   each for 30 of every 40 frames, all on one geometry and texture set.
 * - `uncached pass`: a custom key-sorted pass with `cache: 'never'`, against the same pass cached.
 * - `tiny turnover`: 32 to 512 pooled meshes replacing a quarter, half or all of them every frame.
 * - `almost balanced`: 6,000 paired instances where 0 to 100 of 100 arrivals change geometry.
 * - `edit locality`: 24,000 instances in one command, replaced in scattered, clustered or
 *   contiguous order.
 * - `sparse rows`: a 100,000-slot batch whose 100 live instances sit at the top or the bottom of
 *   the store, in one to eight custom passes.
 */
import { BatchedMesh3D, CubeGeometry, Material3D, Matrix4, RenderPassBit } from '@pixi/3d';
import { frame } from 'benchy';

import { createMembershipPairs, frameMembershipGrid } from './data/membership.ts';
import type { PixiStage } from './stage.ts';

frame('membership material burst', {
  variants: {
    'burst-32': { materials: 32, hold: 30 },
    'burst-8': { materials: 8, hold: 30 },
    'burst-64': { materials: 64, hold: 30 },
    'burst-one-frame': { materials: 32, hold: 1 },
  },
  primary: 'cpu.frame',
  gate: 'strict',
  duration: 2,
  antialias: false,
  options: { cull: 'cpu' },
  create(stage: PixiStage, { materials: materialCount, hold }) {
    frameMembershipGrid(stage);
    const geometry = new CubeGeometry();
    const materials = Array.from(
      { length: materialCount + 1 },
      (_, i) => new Material3D({ baseColor: i ? 0xdc965b : 0x62b9dc, roughness: 0.8 }),
    );
    const residents = 1024;
    const burstSize = materialCount * 8;
    const count = residents + burstSize;
    const batch = new BatchedMesh3D({ size: count, cull: 'cpu' });
    const matrix = new Matrix4();
    const columns = 64;
    const rows = Math.ceil(count / columns);
    const cell = Math.min(34 / columns, 18 / rows);
    for (let i = 0; i < count; i++) {
      const x = ((i % columns) - (columns - 1) / 2) * cell;
      const y = ((rows - 1) / 2 - Math.floor(i / columns)) * cell;
      const size = cell * 0.6;
      matrix.fromArray([size, 0, 0, 0, 0, size, 0, 0, 0, 0, size, 0, x, y, 0, 1]);
      batch.setGeometryAt(i, geometry);
      batch.setMaterialAt(i, materials[i < residents ? 0 : 1 + ((i - residents) % materialCount)]);
      batch.setMatrixAt(i, matrix);
      batch.setPassesAt(i, RenderPassBit.OPAQUE);
    }
    stage.view.root.addChild(batch);
    stage.renderer.render({ container: stage.view.parent ?? stage.view });
    for (let i = residents; i < count; i++) batch.setPassesAt(i, 0);
    stage.view._invalidateDrawCaches();
    stage.renderer.render({ container: stage.view.parent ?? stage.view });
    let shown = false;
    let wanted = false;
    return {
      simulate(seconds) {
        const phase = Math.round(seconds * 60) % 40;
        wanted = phase >= 1 && phase <= hold;
      },
      update() {
        if (wanted === shown) return;
        for (let i = residents; i < count; i++) batch.setPassesAt(i, wanted ? RenderPassBit.OPAQUE : 0);
        shown = wanted;
      },
      destroy() {
        geometry.destroy(true);
        for (const material of materials) material.destroy(true);
      },
    };
  },
});

frame('membership uncached pass', {
  variants: {
    'never-10': { cache: 'never', births: 10 },
    'auto-10': { cache: 'auto', births: 10 },
    'never-100': { cache: 'never', births: 100 },
    'auto-100': { cache: 'auto', births: 100 },
  },
  primary: 'cpu.frame',
  gate: 'strict',
  duration: 20,
  antialias: false,
  options: { cull: 'cpu' },
  create(stage: PixiStage, { cache, births }: { cache: 'auto' | 'never'; births: number }) {
    return createMembershipPairs(stage, { count: 2000, births, cache });
  },
});

frame('membership tiny turnover', {
  variants: {
    'tiny-128-half': { count: 128, births: 64, kinds: 8, objects: true },
    'tiny-32-quarter': { count: 32, births: 8, kinds: 1, objects: true },
    'tiny-32-half': { count: 32, births: 16, kinds: 1, objects: true },
    'tiny-32-full': { count: 32, births: 32, kinds: 1, objects: true },
    'tiny-128-quarter': { count: 128, births: 32, kinds: 8, objects: true },
    'tiny-128-full': { count: 128, births: 128, kinds: 8, objects: true },
    'tiny-512-quarter': { count: 512, births: 128, kinds: 8, objects: true },
    'tiny-512-half': { count: 512, births: 256, kinds: 8, objects: true },
    'tiny-512-full': { count: 512, births: 512, kinds: 8, objects: true },
    'tiny-128-batch': { count: 128, births: 64, kinds: 8, objects: false },
    'tiny-128-one-kind': { count: 128, births: 64, kinds: 1, objects: true },
  },
  primary: 'cpu.frame',
  gate: 'strict',
  duration: 2,
  antialias: false,
  options: { cull: 'cpu' },
  create(stage: PixiStage, knobs) {
    return createMembershipPairs(stage, knobs);
  },
});

frame('membership almost balanced', {
  variants: {
    'mismatch-1': { mismatch: 1 },
    'mismatch-0': { mismatch: 0 },
    'mismatch-10': { mismatch: 10 },
    'mismatch-100': { mismatch: 100 },
  },
  primary: 'cpu.frame',
  gate: 'strict',
  duration: 2,
  antialias: false,
  options: { cull: 'cpu' },
  create(stage: PixiStage, { mismatch }) {
    return createMembershipPairs(stage, { count: 6000, births: 100, kinds: 8, mismatch });
  },
});

frame('membership edit locality', {
  variants: {
    'locality-scattered': { distribution: 'scattered' },
    'locality-clustered': { distribution: 'clustered' },
    'locality-contiguous': { distribution: 'contiguous' },
  },
  primary: 'cpu.frame',
  gate: 'strict',
  duration: 8,
  antialias: false,
  options: { cull: 'cpu' },
  create(stage: PixiStage, { distribution }: { distribution: 'scattered' | 'clustered' | 'contiguous' }) {
    return createMembershipPairs(stage, { count: 24_000, births: 100, distribution });
  },
});

frame('membership sparse rows', {
  variants: {
    'sparse-high-4': { passes: 4, highRows: true, readopt: false },
    'sparse-low-4': { passes: 4, highRows: false, readopt: false },
    'sparse-high-1': { passes: 1, highRows: true, readopt: false },
    'sparse-low-1': { passes: 1, highRows: false, readopt: false },
    'sparse-high-8': { passes: 8, highRows: true, readopt: false },
    'sparse-low-8': { passes: 8, highRows: false, readopt: false },
    'sparse-readopt-high': { passes: 4, highRows: true, readopt: true },
    'sparse-readopt-low': { passes: 4, highRows: false, readopt: true },
  },
  primary: 'cpu.frame',
  gate: 'strict',
  duration: 2,
  antialias: false,
  options: { cull: 'cpu' },
  create(stage: PixiStage, knobs) {
    return createMembershipPairs(stage, { count: 100, births: 10, capacity: 100_000, cache: 'auto', ...knobs });
  },
});
