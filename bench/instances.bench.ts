/**
 * `instances`: one `BatchedMesh3D` of N slots whose matrices are all rewritten every frame, by two write paths.
 *
 * `instances` is the bulk path the engine documents for this: `simulate` composes every matrix straight into the
 * batch's own store (`batch.matrices`, its array re-read every frame, since the engine may replace it), and the update
 * is one `matrices.update()`, which queues every slot for the upload the render does. Judged on `cpu.frame`: the
 * update is a single call, so what the path costs an app is that call plus the render's upload and bounds work, the
 * whole frame.
 *
 * `instances per-slot` is the per-slot API: `simulate` composes into a packed array, and the update is a
 * `Matrix4.fromArray` and a `setMatrixAt` per slot. Judged on `cpu.update`, the write path that question is about;
 * the frame's other numbers are reported beside it, so the two paths' frames can be read side by side.
 *
 * The batch draws unculled (`cull: 'off'`), so every slot is written, uploaded and drawn on every frame.
 */

import { BatchedMesh3D, Matrix4, RenderPassBit } from '@pixi/3d';
import { frame } from 'benchy';

import { instancesScene } from './data/field.ts';
import type { InstancesScene } from './data/field.ts';
import { applyLook, toGeometry, toMaterial } from './stage.ts';
import type { PixiStage } from './stage.ts';

interface Batch {
  data: InstancesScene;
  batch: BatchedMesh3D;
  destroy: () => void;
}

/** The scene's one batch on the stage: every slot the box and the grey material, drawn opaque. */
function build(stage: PixiStage, count: number): Batch {
  const data = instancesScene(count);
  applyLook(stage, data.look);
  const geometry = toGeometry(data.geometry);
  const material = toMaterial(data.material);
  const batch = new BatchedMesh3D({ size: count });
  for (let i = 0; i < count; i++) {
    batch.setGeometryAt(i, geometry);
    batch.setMaterialAt(i, material);
    batch.setItemActive(i, RenderPassBit.OPAQUE);
  }
  stage.view.root.addChild(batch);
  return {
    data,
    batch,
    destroy() {
      geometry.destroy(true);
      material.destroy();
    },
  };
}

frame('instances', {
  variants: { c10k: { count: 10_000 }, c100k: { count: 100_000 } },
  primary: 'cpu.frame',
  gate: 'strict',
  options: { cull: 'off' },
  create(stage: PixiStage, { count }) {
    const { data, batch, destroy } = build(stage, count);
    const { matrices } = batch;
    data.update(0, matrices);
    matrices.update();
    return {
      simulate(seconds) {
        data.update(seconds, matrices);
      },
      update() {
        matrices.update();
      },
      destroy,
    };
  },
});

frame('instances per-slot', {
  variants: { c10k: { count: 10_000 }, c100k: { count: 100_000 } },
  primary: 'cpu.update',
  gate: 'strict',
  options: { cull: 'off' },
  create(stage: PixiStage, { count }) {
    const { data, batch, destroy } = build(stage, count);
    const packed = { data: new Float32Array(count * 16), offset: 0, stride: 16 };
    const scratch = new Matrix4();
    const update = (): void => {
      for (let i = 0; i < count; i++) batch.setMatrixAt(i, scratch.fromArray(packed.data, i * 16));
    };
    data.update(0, packed);
    update();
    return {
      simulate(seconds) {
        data.update(seconds, packed);
      },
      update,
      destroy,
    };
  },
});
