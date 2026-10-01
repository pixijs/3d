/**
 * `skinned`: N Khronos Foxes on a grid, each playing `Walk` from its own point in the clip. The engine's default
 * path, one `Model3D.from` per character over one shared source, each with its own `AnimationPlayer`.
 *
 * Judged on `cpu.frame`, because the animation's work lands in both halves of the frame: the update samples the clip
 * and writes each joint's pose, and the render turns the poses into world and bone matrices and uploads them, so a
 * verdict on either half alone could miss a change in the other.
 *
 * The ladder is 256 and 1024 Foxes, 6,144 and 24,576 bones. It starts at 256 because a host-time verdict needs the
 * host to set the frame, and with fewer characters the GPU's fixed cost of a frame can pace it.
 *
 * Needs the models `benchy assets` downloads.
 */

import { Model3D } from '@pixi/3d';
import type { AnimationPlayer, Scene3DSource } from '@pixi/3d';
import { frame } from 'benchy';
import { Assets, Ticker } from 'pixi.js';

import { skinnedScene } from './data/skinned.ts';
import { applyLook } from './stage.ts';
import type { PixiStage } from './stage.ts';

frame('skinned', {
  variants: { c256: { count: 256 }, c1024: { count: 1024 } },
  primary: 'cpu.frame',
  gate: 'strict',
  async create(stage: PixiStage, { count }) {
    const data = skinnedScene(await stage.asset('Fox'), count);
    applyLook(stage, data.look);
    const source = await Assets.load<Scene3DSource>(data.url);
    const players: AnimationPlayer[] = [];
    for (let i = 0; i < data.count; i++) {
      // Every model shares the one source, so the geometry, material and clips are uploaded once.
      const model = Model3D.from(source, { autoUpdate: false });
      model.position.fromArray(data.position, i * 3);
      model.quaternion.fromArray(data.quat, i * 4);
      model.scale.set(data.scale, data.scale, data.scale);
      const player = model.player;
      if (!player) throw new Error(`skinned: ${data.url} carries no animations`);
      const state = player.play(data.clip);
      state.time = (data.offset[i] ?? 0) * state.animation.duration;
      players.push(player);
      stage.view.root.addChild(model);
    }
    // A ticker of the bench's own, never started: it only carries the step into `update`. Each player samples its
    // clip and writes the pose; the joints' world matrices, the bone matrices and their upload are the render's.
    const step = new Ticker();
    return {
      update(dt) {
        step.deltaMS = dt * 1000;
        for (const player of players) player.update(step);
      },
      destroy() {
        step.destroy();
        // Assets loaded the source and caches its images, so Assets unloads it: destroying it here would destroy
        // textures Assets still manages.
        void Assets.unload(data.url);
      },
    };
  },
});
