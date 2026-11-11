/**
 * `raycast`: hover-style picking outside pointer events, the load of a scene that picks from its own loop.
 * Interactive boxes in a grid that fills most of the view, and `View3D.raycast` calls every
 * frame at points scattered over the whole view, about half of them over nothing.
 *
 * `with-out` passes one reused hit as `out`, the allocation-free form; `no-out` lets each call make its own. The
 * plain pair is 24 boxes, a configurator's handful of parts, cast at 200 times a frame. The `-2k` pair is 2000 boxes,
 * a dense picking field, cast at 20 times a frame, which keeps an allocation profile of it small enough for Chrome
 * to hand back. Judged on `cpu.update`, where the casts run; what a frame allocates is read with
 * `benchy profile --alloc`.
 */

import { CubeGeometry, Material3D, Mesh3D, createRaycastHit3D } from '@pixi/3d';
import { frame } from 'benchy';

import type { PixiStage } from './stage.ts';

const FRAMES = 60;

frame('raycast', {
  variants: {
    'with-out': { out: true, boxes: 24, casts: 200 },
    'no-out': { out: false, boxes: 24, casts: 200 },
    'with-out-2k': { out: true, boxes: 2000, casts: 20 },
    'no-out-2k': { out: false, boxes: 2000, casts: 20 },
  },
  primary: 'cpu.update',
  create({ view, rng }: PixiStage, { out, boxes, casts }) {
    const halfHeight = view.camera.position.z * Math.tan((view.camera.fov * Math.PI) / 360);
    const halfWidth = (halfHeight * view.width) / view.height;
    const cols = Math.ceil(Math.sqrt((boxes * halfWidth) / halfHeight));
    const rows = Math.ceil(boxes / cols);
    const spacing = Math.min((1.8 * halfWidth) / cols, (1.8 * halfHeight) / rows);

    const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
    const material = new Material3D({ baseColor: 0x4f9ed9 });
    for (let i = 0; i < boxes; i++) {
      const mesh = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
      mesh.scale.set(spacing * 0.8);
      mesh.position.set(((i % cols) - (cols - 1) / 2) * spacing, (Math.floor(i / cols) - (rows - 1) / 2) * spacing, 0);
      mesh.eventMode = 'static';
      view.root.addChild(mesh);
    }

    const points = Array.from({ length: casts * FRAMES }, () => ({
      x: rng.range(0, view.width),
      y: rng.range(0, view.height),
    }));
    const hit = createRaycastHit3D();
    let first = 0;

    return {
      simulate(seconds) {
        first = (Math.round(seconds * 60) % FRAMES) * casts;
      },
      update() {
        const end = first + casts;
        if (out) {
          for (let i = first; i < end; i++) view.raycast(points[i]!, hit);
        } else {
          for (let i = first; i < end; i++) view.raycast(points[i]!);
        }
      },
      destroy() {
        geometry.destroy();
        material.destroy();
      },
    };
  },
});
