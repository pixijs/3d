/**
 * `post`: what screen-space post-processing costs over a lit scene: the field at 2000 objects, and a ladder of
 * the effects the view's post chain (`view.passes`) runs over it, `none`, `bloom`, and `bloom-ao` (ambient occlusion
 * over the scene, then bloom over the occluded frame). Judged on `gpu.frame`, where every effect's passes run; the
 * scene under them is the same on every rung.
 *
 * Multisampling is off unless `--msaa 4` asks for it: a post chain can run over a single-sampled copy of the frame,
 * and a `none` rung drawn multisampled straight to the canvas beside it would change two things in one step.
 *
 * Bloom is `BloomEffect`, and occlusion is `SsaoEffect` at sixteen samples a pixel.
 *
 * The view culls on the CPU (`cull: 'cpu'`): a GPU cull compacts the survivors in whatever order its threads finish,
 * so two runs would not draw the same frame.
 */

import { Mesh3D } from '@pixi/3d';
import type { Pass3D } from '@pixi/3d';
import { BloomEffect, SsaoEffect } from '@pixi/3d/extras';
import { frame } from 'benchy';

import { postScene } from './data/post.ts';
import type { PostEffects } from './data/post.ts';
import { applyLook, toGeometry, toMaterial } from './stage.ts';
import type { PixiStage } from './stage.ts';

frame('post', {
  variants: { none: { effects: 'none' }, bloom: { effects: 'bloom' }, 'bloom-ao': { effects: 'bloom-ao' } },
  primary: 'gpu.frame',
  gate: 'strict',
  antialias: false,
  options: { cull: 'cpu' },
  create(stage: PixiStage, { effects }: { effects: PostEffects }) {
    const data = postScene();
    applyLook(stage, data.look);
    const { view } = stage;
    const geometries = data.geometries.map(toGeometry);
    const materials = data.materials.map(toMaterial);
    const meshes: Mesh3D[] = [];
    for (let i = 0; i < data.count; i++) {
      const geometry = geometries[data.geom[i] ?? 0];
      const material = materials[data.material[i] ?? 0];
      if (!geometry || !material) throw new Error(`post: object ${i} names a geometry or material that is not there`);
      const mesh = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
      mesh.position.fromArray(data.position, i * 3);
      mesh.scale.set(data.scale[i] ?? 1);
      mesh.quaternion.fromArray(data.quat, i * 4);
      meshes.push(view.root.addChild(mesh));
    }

    // Occlusion first when the rung has it, then bloom over the occluded frame.
    const chain: Pass3D[] = [];
    if (effects === 'bloom-ao') chain.push(new SsaoEffect({ radius: data.ao.radius, samples: data.ao.samples }));
    if (effects !== 'none') {
      const { strength, threshold, radius } = data.bloom;
      chain.push(new BloomEffect({ threshold, intensity: strength, radius }));
    }
    view.passes = chain;

    const quat = data.quat;
    return {
      simulate(seconds) {
        data.update(seconds);
      },
      update() {
        let at = 0;
        for (const mesh of meshes) {
          mesh.quaternion.fromArray(quat, at);
          at += 4;
        }
      },
      destroy() {
        for (const effect of chain) effect.destroy();
        for (const geometry of geometries) geometry.destroy(true);
        for (const material of materials) material.destroy();
      },
    };
  },
});
