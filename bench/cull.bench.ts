/**
 * `cpu cull`: frustum culling on the CPU, in a frame. The `field` scene at twenty thousand meshes, with the camera
 * turned by half its horizontal field of view so the frustum's edge runs down the middle of the field and about half
 * the meshes are in view. The view culls on the CPU (`cull: 'cpu'`), so every frame tests each mesh's bounds against
 * the view's planes and compacts the survivors inside the render. Every mesh spins, so the bounds it tests have moved
 * since the last frame. Judged on `cpu.render`, where all of it runs.
 */

import { frame } from 'benchy';

import { fieldScene } from './data/field.ts';
import { SCENE_ASPECT } from './data/look.ts';
import { meshPerObject } from './meshes.ts';
import { applyLook } from './stage.ts';
import type { PixiStage } from './stage.ts';

frame('cpu cull', {
  primary: 'cpu.render',
  gate: 'strict',
  options: { cull: 'cpu' },
  create(stage: PixiStage) {
    const data = fieldScene(20_000);
    const { camera } = data.look;
    // Looks along the right edge of the frustum the field fills, which puts the view's left edge on the field's
    // centre line.
    const tanHalfWidth = Math.tan((camera.fovY * Math.PI) / 360) * SCENE_ASPECT;
    camera.target = [camera.position[2] * tanHalfWidth, 0, 0];
    applyLook(stage, data.look);
    return meshPerObject(stage, data);
  },
});
