/**
 * `field`: N unique animated meshes over eight generated geometries, one `Mesh3D` each, every transform
 * rewritten every frame. What it measures is the per-object cost (the scene graph walk, the bounds, the batcher's
 * runs), so the ladder is the comparison, and the objects shrink as the count grows, which keeps the screen about as
 * covered and the fill rate out of the answer.
 *
 * The `still20k` and `still50k` variants skip the transform writes, so they time a frame where nothing in the scene
 * changed.
 *
 * Judged on `cpu.render`: the walk, the bounds and the batching all happen inside `renderer.render`, and the
 * quaternion writes that mark each transform dirty are the update's. A frame's time over both would dilute an engine
 * change inside the render with a write path that did not move.
 *
 * The ladder starts at twenty thousand because the verdict rests on a host time, and that is only a reading of the
 * host where the GPU has room in the frame. The scene keeps its fill constant whatever the count, so at lower counts
 * that fill is most of the frame and a host-time verdict is a reading of the GPU.
 *
 * The view keeps the engine's default culling, which is part of the per-object cost this measures.
 */

import { frame } from 'benchy';

import { fieldScene } from './data/field.ts';
import { meshPerObject } from './meshes.ts';
import { applyLook } from './stage.ts';
import type { PixiStage } from './stage.ts';

frame('field', {
  variants: {
    c20k: { count: 20_000, still: false },
    c50k: { count: 50_000, still: false },
    still20k: { count: 20_000, still: true },
    still50k: { count: 50_000, still: true },
  },
  primary: 'cpu.render',
  gate: 'strict',
  create(stage: PixiStage, { count, still }) {
    const data = fieldScene(count);
    applyLook(stage, data.look);
    return meshPerObject(stage, data, still);
  },
});
