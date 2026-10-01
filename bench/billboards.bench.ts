/**
 * `billboards`: N camera-facing sprites in a ball the camera circles, all one soft round texture and one colour. Each
 * is a `Sprite3D` sharing one `FlatMaterial`, the form that lets the batcher draw them together (a sprite built from
 * a texture would own a material of its own); unlit, blended and sorted back to front, as sprites are by default.
 *
 * Judged on `cpu.render`, where the sort, the cull, the batching and the draws are. The update is one camera move.
 * The sprites shrink as the count grows, so fill stays out of the answer. Ten thousand is the first rung, the one a
 * verdict reads without `--variant`, because a host-time verdict needs the host to set the frame, and a thousand
 * sprites can render in less time than the GPU's floor for a multisampled 1080p frame.
 *
 * The view culls on the CPU (`cull: 'cpu'`): a GPU cull compacts the survivors in whatever order its threads finish,
 * which reorders the blended sprites, so no two runs would draw the same frame.
 */

import { FlatMaterial, Sprite3D } from '@pixi/3d';
import { frame } from 'benchy';

import { billboardsScene } from './data/billboards.ts';
import { applyLook, displayColor, toTexture } from './stage.ts';
import type { PixiStage } from './stage.ts';

frame('billboards', {
  variants: { c10k: { count: 10_000 }, c1k: { count: 1000 }, c50k: { count: 50_000 } },
  primary: 'cpu.render',
  gate: 'strict',
  options: { cull: 'cpu' },
  create(stage: PixiStage, { count }) {
    const data = billboardsScene(count);
    applyLook(stage, data.look);
    const { view } = stage;
    const texture = toTexture(data.texture, 'billboards-disc');
    // What a `Sprite3D` builds for itself from a texture: blended, and one program for both faces.
    const material = new FlatMaterial({
      baseColor: displayColor(data.color),
      baseColorTexture: texture,
      alphaMode: 'blend',
      doubleSided: true,
    });
    for (let i = 0; i < data.count; i++) {
      const size = data.size[i] ?? 1;
      const sprite = new Sprite3D({ material, width: size, height: size });
      sprite.position.fromArray(data.position, i * 3);
      view.root.addChild(sprite);
    }
    // The data moves the camera in place, so the update reads its position where the circle left it.
    const eye = data.look.camera.position;
    const [x, y, z] = data.look.camera.target;
    const target = { x, y, z };
    return {
      simulate(seconds) {
        data.update(seconds);
      },
      update() {
        view.camera.position.set(eye[0], eye[1], eye[2]);
        view.camera.lookAt(target);
      },
      destroy() {
        material.destroy();
        texture.destroy(true);
      },
    };
  },
});
