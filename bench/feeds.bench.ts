/**
 * `feeds`: camera feeds over a scene that changes every frame. The field at 10 000 still meshes, drawn by the view
 * and again by `feeds` cameras, each with a 256² render texture and its own `MeshPass` on `'opaque'`, as a fisheye
 * lens draws its six faces or a security monitor its feed. Every frame one more mesh joins the scene or leaves it,
 * behind the view's camera so the gated frame never shows it, which makes the shared opaque draw list stale on every
 * frame. Every pass on `'opaque'` draws that one list, so what this measures is how the rebuild a stale list needs
 * scales with the passes drawing it. Judged on `cpu.render`, where the rebuild runs.
 *
 * The feeds see a quarter of the view's field of view and multisampling is off, which keeps the GPU's share of the
 * frame under the host's, so `cpu.render` reads the host. The view culls on the CPU (`cull: 'cpu'`): a GPU cull
 * compacts the survivors in whatever order its threads finish, so two runs would not draw the same frame.
 */

import { Camera3D, MeshPass, Mesh3D } from '@pixi/3d';
import { frame } from 'benchy';
import { RenderTexture } from 'pixi.js';

import { fieldScene } from './data/field.ts';
import { applyLook, toGeometry, toMaterial } from './stage.ts';
import type { PixiStage } from './stage.ts';

/** How far apart the feeds aim along the field, in world units at its centre. */
const FEED_SPREAD = 6;

frame('feeds', {
  variants: { feeds1: { feeds: 1 }, feeds6: { feeds: 6 } },
  primary: 'cpu.render',
  gate: 'strict',
  antialias: false,
  options: { cull: 'cpu' },
  create(stage: PixiStage, { feeds }: { feeds: number }) {
    const data = fieldScene(10_000);
    applyLook(stage, data.look);
    const { view } = stage;
    const geometries = data.geometries.map(toGeometry);
    const materials = data.materials.map(toMaterial);
    for (let i = 0; i < data.count; i++) {
      const geometry = geometries[data.geom[i] ?? 0];
      const material = materials[data.material[i] ?? 0];
      if (!geometry || !material) throw new Error(`feeds: object ${i} names a geometry or material that is not there`);
      const mesh = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
      mesh.position.fromArray(data.position, i * 3);
      mesh.scale.set(data.scale[i] ?? 1);
      mesh.quaternion.fromArray(data.quat, i * 4);
      view.root.addChild(mesh);
    }

    const spec = data.look.camera;
    const textures: RenderTexture[] = [];
    const passes: MeshPass[] = [];
    for (let i = 0; i < feeds; i++) {
      const texture = RenderTexture.create({ width: 256, height: 256, resolution: 1, label: `feed-${i}` });
      const camera = new Camera3D({ fov: spec.fovY / 4, near: spec.near, far: spec.far, renderTexture: texture });
      camera.position.set(spec.position[0], spec.position[1], spec.position[2]);
      camera.lookAt({ x: spec.target[0] + (i - (feeds - 1) / 2) * FEED_SPREAD, y: spec.target[1], z: spec.target[2] });
      view.root.addChild(camera);
      textures.push(texture);
      passes.push(new MeshPass({ name: 'opaque', camera }));
    }
    view.passes = passes;

    const firstGeometry = geometries[0];
    const firstMaterial = materials[0];
    if (!firstGeometry || !firstMaterial) throw new Error('feeds: the field has no geometry or material');
    const churn = new Mesh3D({
      geometry: firstGeometry,
      material: firstMaterial,
      castShadow: false,
      receiveShadow: false,
    });
    churn.position.set(spec.position[0], spec.position[1], spec.position[2] + 20);

    return {
      update() {
        if (churn.parent) churn.removeFromParent();
        else view.root.addChild(churn);
      },
      destroy() {
        churn.destroy();
        view.passes = null;
        for (const pass of passes) pass.destroy();
        for (const texture of textures) texture.destroy(true);
        for (const geometry of geometries) geometry.destroy(true);
        for (const material of materials) material.destroy(true);
      },
    };
  },
});
