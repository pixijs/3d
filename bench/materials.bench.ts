/**
 * `materials`: 20 000 meshes over M distinct materials. The count is fixed and the material count is the ladder,
 * so what moves is how much the batcher can collapse: one material is one long run of instanced draws, and 64
 * materials is the same geometry broken into runs by whichever material each object happens to have.
 *
 * Judged on `cpu.render`, where the batcher runs; the update is the same 20 000 quaternion writes on every rung. It is
 * `field`'s scene over a palette, at the count `field`'s ladder starts at and for `field`'s reason: a host-time verdict
 * only reads the host where the GPU has room in the frame, and with fewer meshes the fill the scene keeps constant is
 * most of the frame.
 */

import { frame } from 'benchy';

import { materialsScene } from './data/field.ts';
import { meshPerObject } from './meshes.ts';
import { applyLook } from './stage.ts';
import type { PixiStage } from './stage.ts';

frame('materials', {
  variants: { m1: { materials: 1 }, m8: { materials: 8 }, m64: { materials: 64 } },
  primary: 'cpu.render',
  gate: 'strict',
  create(stage: PixiStage, { materials }) {
    const data = materialsScene(materials);
    applyLook(stage, data.look);
    return meshPerObject(stage, data);
  },
});
