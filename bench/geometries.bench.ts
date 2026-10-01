/**
 * `geometries`: the `textures` field at 32 textured materials, spread over N distinct geometries rather than
 * eight (`g10`, `g100`, `g500`). Geometry `i` is the field's own shape `i % 8` at the field's own segment counts, bent
 * a little by its index (`geometryVariants` in `data/geometry.ts`), so every one is a vertex buffer of its own while
 * every rung draws about the vertices `textures` draws. The ladder is how often a change of geometry breaks the
 * batch's runs.
 *
 * Judged on `gpu.frame`, with `cpu.render` beside it for the batcher: a scene this heavy on the GPU can leave a host
 * number carrying its queue. The canvas keeps `textures`' four samples, so the rungs compare with its `t32`.
 */

import { frame } from 'benchy';

import { geometriesScene } from './data/field.ts';
import { meshPerObject } from './meshes.ts';
import { applyLook } from './stage.ts';
import type { PixiStage } from './stage.ts';

frame('geometries', {
  variants: { g10: { geometries: 10 }, g100: { geometries: 100 }, g500: { geometries: 500 } },
  primary: 'gpu.frame',
  gate: 'strict',
  create(stage: PixiStage, { geometries }) {
    const data = geometriesScene(geometries);
    applyLook(stage, data.look);
    return meshPerObject(stage, data);
  },
});
