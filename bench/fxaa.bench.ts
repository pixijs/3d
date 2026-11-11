/**
 * `fxaa`: what `FxaaEffect` costs over the lit field.
 *
 * Both variants run one fullscreen pass after the scene, so the scene under it is the same on both and the
 * difference is the pass's own:
 *
 * - `fxaa`: `FxaaEffect` as the engine ships it. First, so `--against` measures a change to it.
 * - `copy`: a pass that only copies its input, the floor any fullscreen pass pays. It runs `'afterToneMapping'`, as
 *   `FxaaEffect` does, so both draw the same 8-bit scene.
 *
 * Multisampling is off, because FXAA replaces it. Judged on `gpu.frame`.
 *
 * The view culls on the CPU (`cull: 'cpu'`): a GPU cull compacts the survivors in whatever order its threads finish,
 * so two runs would not draw the same frame.
 */

import { Mesh3D } from '@pixi/3d';
import { FxaaEffect } from '@pixi/3d/extras';
import { frame } from 'benchy';

import { CopyEffect } from './copy.ts';
import { postScene } from './data/post.ts';
import { applyLook, toGeometry, toMaterial } from './stage.ts';
import type { PixiStage } from './stage.ts';

frame('fxaa', {
  variants: { fxaa: { pass: 'fxaa' }, copy: { pass: 'copy' } },
  primary: 'gpu.frame',
  antialias: false,
  options: { cull: 'cpu' },
  create(stage: PixiStage, { pass }: { pass: 'fxaa' | 'copy' }) {
    const data = postScene();
    applyLook(stage, data.look);
    const { view } = stage;
    const geometries = data.geometries.map(toGeometry);
    const materials = data.materials.map(toMaterial);
    const meshes: Mesh3D[] = [];
    for (let i = 0; i < data.count; i++) {
      const geometry = geometries[data.geom[i] ?? 0];
      const material = materials[data.material[i] ?? 0];
      if (!geometry || !material) throw new Error(`fxaa: object ${i} names a geometry or material that is not there`);
      const mesh = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
      mesh.position.fromArray(data.position, i * 3);
      mesh.scale.set(data.scale[i] ?? 1);
      mesh.quaternion.fromArray(data.quat, i * 4);
      meshes.push(view.root.addChild(mesh));
    }

    const effect = pass === 'fxaa' ? new FxaaEffect() : new CopyEffect({ stage: 'afterToneMapping' });
    view.passes = [effect];

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
        effect.destroy();
        for (const geometry of geometries) geometry.destroy(true);
        for (const material of materials) material.destroy();
      },
    };
  },
});
