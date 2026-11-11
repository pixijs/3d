/**
 * `batches`: B separate `BatchedMesh3D`s, each a block of eight boxes on a node that spins. The boxes never move
 * inside their batch, so a frame's cost scales with batches, not boxes: `update` turns every batch's node each
 * frame, which changes its world matrix, and each batch draws with its own. The batch count is the ladder.
 *
 * Judged on `cpu.render`, where the per-batch work is: binding each batch's stores and textures, handing the shader
 * its world matrix, and issuing its draws. Two of the four materials carry a map pair, so the batches use two
 * shaders.
 *
 * The batches draw unculled (`cull: 'off'`), so every one is drawn on every frame.
 *
 * The `-moving` variants also bob one box in every batch each frame, so every batch's store uploads a row each
 * frame: the worst case for one store upload per batch (#543).
 */

import { BatchedMesh3D, Matrix4, RenderPassBit } from '@pixi/3d';
import { frame } from 'benchy';

import { batchesScene, SLOTS } from './data/batches.ts';
import { applyLook, toGeometry, toMaterial } from './stage.ts';
import type { PixiStage } from './stage.ts';

frame('batches', {
  variants: {
    b64: { count: 64, moving: false },
    b256: { count: 256, moving: false },
    b1024: { count: 1024, moving: false },
    'b256-moving': { count: 256, moving: true },
    'b1024-moving': { count: 1024, moving: true },
  },
  primary: 'cpu.render',
  gate: 'strict',
  options: { cull: 'off' },
  create(stage: PixiStage, { count, moving }: { count: number; moving: boolean }) {
    const data = batchesScene(count);
    applyLook(stage, data.look);
    const geometry = toGeometry(data.geometry);
    const materials = data.materials.map(toMaterial);
    const scratch = new Matrix4();
    const batches: BatchedMesh3D[] = [];
    for (let b = 0; b < count; b++) {
      const material = materials[data.material[b] ?? 0];
      if (!material) throw new Error(`batches: batch ${b} names a material that is not there`);
      const batch = new BatchedMesh3D({ size: SLOTS });
      for (let i = 0; i < SLOTS; i++) {
        batch.setGeometryAt(i, geometry);
        batch.setMaterialAt(i, material);
        batch.setMatrixAt(i, scratch.fromArray(data.slots, i * 16));
        batch.setPassesAt(i, RenderPassBit.OPAQUE);
      }
      batch.position.set(data.position[b * 3] ?? 0, data.position[b * 3 + 1] ?? 0, data.position[b * 3 + 2] ?? 0);
      batches.push(stage.view.root.addChild(batch));
    }
    const quat = data.quat;
    const bobbed = new Matrix4();
    let bob = 0;
    return {
      simulate(seconds) {
        data.update(seconds);
        bob = Math.sin(seconds * 3) * data.slots[0];
      },
      update() {
        let at = 0;
        for (const batch of batches) {
          batch.quaternion.fromArray(quat, at);
          at += 4;
        }
        if (!moving) return;
        bobbed.fromArray(data.slots, 0);
        bobbed.elements[13] += bob;
        for (const batch of batches) batch.setMatrixAt(0, bobbed);
      },
      destroy() {
        geometry.destroy(true);
        for (const material of materials) material.destroy(true);
      },
    };
  },
});
