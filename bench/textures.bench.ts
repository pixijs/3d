/**
 * `textures`: the field at 5000 meshes over M textured materials, each white with a base-colour and a normal map of
 * its own (`data/textures.ts`, 256² with mips). Every material brings two textures of its own, so on top of the runs
 * `materials` breaks, the ladder (`t8`, `t32`, `t128`) asks what more textures than a batch has slots for cost.
 *
 * Judged on `gpu.frame`, where the sampling and the slots are; `cpu.render` is reported beside it for the batcher.
 * The maps keep pixi's default clamped addressing; the field's UVs stay inside the unit square, so clamping differs
 * from repeating only in how the maps' edge texels are filtered.
 */

import { frame } from 'benchy';

import { texturesScene } from './data/field.ts';
import { meshPerObject } from './meshes.ts';
import { applyLook } from './stage.ts';
import type { PixiStage } from './stage.ts';

frame('textures', {
  variants: { t8: { materials: 8 }, t32: { materials: 32 }, t128: { materials: 128 } },
  primary: 'gpu.frame',
  gate: 'strict',
  create(stage: PixiStage, { materials }) {
    const data = texturesScene(materials);
    applyLook(stage, data.look);
    return meshPerObject(stage, data);
  },
});
