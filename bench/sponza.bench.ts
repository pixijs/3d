/**
 * `sponza`: the Sponza fly-through, loaded by the engine's own glTF loader and flown along one camera path:
 * every surface a textured PBR material as an artist authored it, the fragments whatever the camera sees, and
 * everything else the engine does around them.
 *
 * Judged on `gpu.frame`, since this is a shading question. The update is one camera move, a tick of the clock or
 * none, so read `cpu.update` as noise here.
 *
 * Needs the models `benchy assets` downloads.
 */

import { Model3D } from '@pixi/3d';
import type { Scene3DSource } from '@pixi/3d';
import { frame } from 'benchy';
import { Assets } from 'pixi.js';

import { flyThrough } from './data/sponza.ts';
import { applyLook } from './stage.ts';
import type { PixiStage } from './stage.ts';

frame('sponza', {
  primary: 'gpu.frame',
  gate: 'strict',
  // A pass is the dolly's 16 s period, the whole run along the hall and back.
  duration: 16,
  async create(stage: PixiStage) {
    const entry = await stage.asset('Sponza');
    const data = flyThrough(entry.url, entry.worldBounds ?? entry.bounds);
    applyLook(stage, data.look);
    const { view } = stage;
    const source = await Assets.load<Scene3DSource>(data.url);
    view.root.addChild(Model3D.from(source, { autoUpdate: false }));
    // The camera path moves the pose in the data; `simulate` copies it into two reused points, so the update only
    // hands it to the engine and allocates nothing.
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
        // Assets loaded the source and caches its images, so Assets unloads it: destroying it here would destroy
        // textures Assets still manages.
        void Assets.unload(data.url);
      },
    };
  },
});
