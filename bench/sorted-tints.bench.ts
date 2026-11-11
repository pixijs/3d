import { Material3D, Mesh3D, SphereGeometry } from '@pixi/3d';
import { frame } from 'benchy';

import type { PixiStage } from './stage.ts';

/**
 * `sorted-tints`: 2 000 alpha-blended spheres on one geometry, in four tints, while the camera circles them (`c2000`) or
 * holds still (`still`)
 *
 * The blended pass sorts back to front every frame, so neighbours in depth rarely share a tint: the four materials
 * interleave through the whole list. Judged on `cpu.render`, where the sort and the draw list it rebuilds land. A
 * still camera keeps the order, so the pass replays the draw list it built.
 */

const TINTS = [0xff4040, 0x40ff40, 0x4040ff, 0xffff40];

frame('sorted-tints', {
  variants: { c2000: { count: 2000, orbit: true }, still: { count: 2000, orbit: false } },
  primary: 'cpu.render',
  create(stage: PixiStage, { count, orbit }: { count: number; orbit: boolean }) {
    const { view, rng } = stage;
    const geometry = new SphereGeometry({ radius: 0.6, widthSegments: 12, heightSegments: 8 });
    const materials = TINTS.map((color) => new Material3D({ baseColor: color, alpha: 0.5, alphaMode: 'blend' }));
    for (let i = 0; i < count; i++) {
      const mesh = new Mesh3D({ geometry, material: materials[i % materials.length], castShadow: false });
      mesh.position.set(rng.range(-14, 14), rng.range(-14, 14), rng.range(-14, 14));
      view.root.addChild(mesh);
    }
    let angle = 0;
    return {
      simulate(seconds) {
        angle = orbit ? seconds * 0.5 : 0.6;
      },
      update() {
        view.camera.position.set(Math.sin(angle) * 40, 6, Math.cos(angle) * 40);
        view.camera.lookAt({ x: 0, y: 0, z: 0 });
      },
      destroy() {
        geometry.destroy(true);
        for (const material of materials) material.destroy();
      },
    };
  },
});
