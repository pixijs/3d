/**
 * `sponza shadows`: the `sponza` fly-through with its sun casting. The model's own materials, mask-mode plants and
 * chains among them, cast from one 2048 map fitted to the model's bounds, so this is what shadow maps cost on a
 * scene an artist authored. `off` is the same fly-through with no shadow, so `sun` less `off` is the map and its
 * lookups.
 *
 * Judged on `gpu.frame`; `cpu.render` beside it carries the shadow pass's submission. The view culls on the CPU so
 * two runs draw the same frame.
 *
 * Needs the models `benchy assets` downloads.
 */

import { Box, Model3D, Vector3 } from '@pixi/3d';
import type { Scene3DSource } from '@pixi/3d';
import { frame } from 'benchy';
import { Assets } from 'pixi.js';

import { flyThrough } from './data/sponza.ts';
import { applyLook } from './stage.ts';
import type { PixiStage } from './stage.ts';

frame('sponza shadows', {
  variants: { sun: { casting: true }, off: { casting: false } },
  primary: 'gpu.frame',
  duration: 16,
  options: { cull: 'cpu' },
  async create(stage: PixiStage, { casting }: { casting: boolean }) {
    const entry = await stage.asset('Sponza');
    const extent = entry.worldBounds ?? entry.bounds;
    const data = flyThrough(entry.url, extent);
    applyLook(stage, data.look);
    const { view, lights } = stage;
    view.shadowQuality = 'high';
    view.shadowFilter = 'pcf';
    lights.sun.castShadow = casting;
    const [x0 = 0, y0 = 0, z0 = 0] = extent.min;
    const [x1 = 0, y1 = 0, z1 = 0] = extent.max;
    lights.sun.shadow.bounds = new Box(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1));
    const source = await Assets.load<Scene3DSource>(data.url);
    view.root.addChild(Model3D.from(source, { autoUpdate: false }));
    const eye = { x: 0, y: 0, z: 0 };
    const aim = { x: 0, y: 0, z: 0 };
    return {
      simulate(seconds) {
        data.update(seconds);
        const { position, target } = data.look.camera;
        [eye.x, eye.y, eye.z] = position;
        [aim.x, aim.y, aim.z] = target;
      },
      update() {
        view.camera.position.set(eye.x, eye.y, eye.z);
        view.camera.lookAt(aim);
      },
      destroy() {
        void Assets.unload(data.url);
      },
    };
  },
});
