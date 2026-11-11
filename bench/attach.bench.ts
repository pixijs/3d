/**
 * `attach`: the cost of taking meshes out of a scene and putting them back, with no render in between. What it
 * measures is the attach and detach bookkeeping alone (slot lists, store rows, pass membership, the queues), which is
 * what a spawn or despawn pays before the next frame's rebuild. One variant removes and re-adds 100 of 5,000 meshes.
 */
import { CubeGeometry, Material3D, Mesh3D, View3D } from '@pixi/3d';
import { cpu } from 'benchy';

import { mulberry32 } from './data/rng.ts';

const MESHES = 5000;
const CHURN = 100;

cpu('remove and re-add 100 of 5k meshes', function* () {
  const random = mulberry32(0x5eed_2026);
  const view = new View3D({ width: 256, height: 256 });
  const geometries = Array.from({ length: 8 }, () => new CubeGeometry({ width: 1, height: 1, depth: 1 }));
  const materials = Array.from({ length: 4 }, () => new Material3D({ baseColor: 0xffffff }));
  const meshes: Mesh3D[] = [];
  for (let i = 0; i < MESHES; i++) {
    const mesh = new Mesh3D({ geometry: geometries[i % 8], material: materials[i % 4] });
    mesh.position.set(random() * 20 - 10, random() * 20 - 10, random() * 20 - 10);
    meshes.push(view.root.addChild(mesh));
  }
  const churned = Array.from({ length: CHURN }, (_, k) => meshes[(k * 37) % MESHES]);
  yield {
    bench: () => {
      for (let k = 0; k < CHURN; k++) view.root.removeChild(churned[k]);
      for (let k = 0; k < CHURN; k++) view.root.addChild(churned[k]);
      return view.meshes.items.length;
    },
    snapshot: () => view.meshes.items.length,
  };
  view.destroy();
});
