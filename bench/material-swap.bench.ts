/**
 * `material swap`: a standing population whose materials keep changing. 6000 meshes over 500 geometries and 32
 * textured materials, all in the scene, and every frame N of them take the next material in the palette through
 * `mesh.material`. Nothing is added, removed, created or destroyed, so what a frame pays beyond the static field is
 * each swapped mesh finding its shader again and the batch rebuilding its draw list around the change.
 *
 * Judged on `cpu.render`, where the batch rebuild and each swapped mesh's material re-key run; the update only
 * assigns the materials.
 *
 * Which mesh holds which material is a function of the frame alone: a window of N places in a shuffled order of the
 * objects moves N places a frame, and each object steps one material along the palette every time the window passes
 * it. So every arm swaps the same objects on the same frame, and a pass that starts over puts every material back.
 */

import { Mesh3D } from '@pixi/3d';
import { frame } from 'benchy';

import { churnScene } from './data/field.ts';
import { rng } from './data/rng.ts';
import { applyLook, toGeometry, toMaterial } from './stage.ts';
import type { PixiStage } from './stage.ts';

frame('material swap', {
  variants: { s10: { swaps: 10 }, s100: { swaps: 100 } },
  primary: 'cpu.render',
  gate: 'strict',
  create(stage: PixiStage, { swaps }: { swaps: number }) {
    const data = churnScene();
    applyLook(stage, data.look);
    const { view } = stage;
    const geometries = data.geometries.map(toGeometry);
    const materials = data.materials.map(toMaterial);
    const count = data.count;
    const meshes: Mesh3D[] = [];
    for (let i = 0; i < count; i++) {
      const geometry = geometries[data.geom[i] ?? 0];
      const material = materials[data.material[i] ?? 0];
      if (!geometry || !material) {
        throw new Error(`material swap: object ${i} names a geometry or material that is not there`);
      }
      const mesh = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
      mesh.position.fromArray(data.position, i * 3);
      mesh.scale.set(data.scale[i] ?? 1);
      mesh.quaternion.fromArray(data.quat, i * 4);
      meshes.push(mesh);
      view.root.addChild(mesh);
    }

    const place = new Int32Array(count);
    const shuffle = rng(2900);
    const order = Array.from({ length: count }, (_, i) => i);
    for (let i = count - 1; i > 0; i--) {
      const j = shuffle.int(i + 1);
      const swap = order[i] ?? 0;
      order[i] = order[j] ?? 0;
      order[j] = swap;
    }
    order.forEach((object, at) => (place[object] = at));

    const palette = materials.length;
    const held = new Int32Array(count);
    for (let i = 0; i < count; i++) held[i] = data.material[i] ?? 0;

    /** The material object `object` holds on `frameIndex`: one step along the palette per pass of the window */
    const materialAt = (object: number, frameIndex: number): number => {
      const head = frameIndex * swaps;
      const at = place[object] ?? 0;
      const passes = head > at ? Math.floor((head - at - 1) / count) + 1 : 0;
      return ((data.material[object] ?? 0) + passes) % palette;
    };

    let frameIndex = 0;
    return {
      simulate(seconds) {
        frameIndex = Math.round(seconds * 60);
      },
      update() {
        for (let i = 0; i < count; i++) {
          const wanted = materialAt(i, frameIndex);
          if (held[i] === wanted) continue;
          (meshes[i] as Mesh3D).material = materials[wanted] as (typeof materials)[number];
          held[i] = wanted;
        }
      },
      destroy() {
        for (const geometry of geometries) geometry.destroy(true);
        for (const material of materials) material.destroy(true);
      },
    };
  },
});
