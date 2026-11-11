/**
 * Membership churn under a moving camera: 6,000 instances over eight geometries from a pool of
 * 12,000, 100 replaced and 200 matrices written every frame, with the camera panning across the
 * field so the culls' survivor counts change. `held` variants write the same matrices with no
 * membership edits; `fixed` variants keep the camera still. CPU and GPU culling variants of each.
 */
import { BatchedMesh3D, Matrix4 } from '@pixi/3d';
import { frame } from 'benchy';

import { createMembershipPairs } from './data/membership.ts';
import type { PixiStage } from './stage.ts';

/** Changing camera survivors alongside balanced membership edits, with matched no-churn controls. */
frame('membership moving camera', {
  variants: {
    'gpu-churn': { cull: 'gpu', churn: true, camera: true },
    'gpu-held': { cull: 'gpu', churn: false, camera: true },
    'cpu-churn': { cull: 'cpu', churn: true, camera: true },
    'cpu-held': { cull: 'cpu', churn: false, camera: true },
    'gpu-fixed': { cull: 'gpu', churn: true, camera: false },
    'cpu-fixed': { cull: 'cpu', churn: true, camera: false },
  },
  primary: 'cpu.frame',
  gate: 'strict',
  duration: 4,
  antialias: false,
  create(stage: PixiStage, { cull, churn, camera }) {
    if (cull !== 'cpu' && cull !== 'gpu') throw new Error('Camera comparisons require CPU or GPU culling.');
    const scene = createMembershipPairs(stage, { count: 6000, births: 100, kinds: 8, cull, churn, pairShift: 0 });
    const batch = stage.view.root.children.find((child): child is BatchedMesh3D => child instanceof BatchedMesh3D);
    if (!batch) throw new Error('The camera benchmark requires the membership helper to create a batch.');

    // Move 100 pairs spread across the field. Update both resident slots in every variant,
    // so the no-churn control pays the same matrix-upload work without membership edits.
    const slots = Uint32Array.from({ length: 200 }, (_, i) => (i % 100) * 60 + Math.floor(i / 100) * 6000);
    const poses = new Float32Array(slots.length * 16);
    const baseY = new Float32Array(slots.length);
    const { data, stride, offset } = batch.matrices;
    for (let i = 0; i < slots.length; i++) {
      const source = offset + slots[i] * stride;
      for (let lane = 0; lane < 16; lane++) poses[i * 16 + lane] = data[source + lane];
      baseY[i] = poses[i * 16 + 13];
    }
    const matrix = new Matrix4();
    const aim = { x: 0, y: 0, z: 0 };
    return {
      simulate(seconds) {
        scene.simulate?.(seconds);
        const phase = (Math.round(seconds * 60) % 240) / 240;
        aim.x = camera ? 32 * Math.sin(phase * Math.PI * 2) : 0;
        for (let i = 0; i < slots.length; i++) {
          const at = i * 16;
          poses[at + 13] = baseY[i] + poses[at] * 0.1 * Math.sin(phase * Math.PI * 4 + (i % 100));
        }
      },
      update(dt) {
        scene.update?.(dt);
        stage.view.camera.position.set(aim.x, 0, 32);
        stage.view.camera.lookAt(aim);
        for (let i = 0; i < slots.length; i++) batch.setMatrixAt(slots[i], matrix.fromArray(poses, i * 16));
      },
      destroy() {
        scene.destroy?.();
      },
    };
  },
});
