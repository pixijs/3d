/**
 * `picking`: triangle-exact picking over nested parts, the load of a product configurator whose parts sit inside one
 * another and each pick with `hitVolume: 'geometry'`, as the shoe configurator's eight do. Eight torus knots of 6144
 * triangles each share one centre, scaled from 1 down to 0.6, and `View3D.raycast` runs at 32 fixed points over them
 * every frame.
 *
 * The pick list is visited in the order the meshes joined it, so `outer-first` adds the largest knot first and
 * `inner-first` the smallest, to show how much the visit order decides. Judged on `cpu.update`, where the casts run.
 */

import { Material3D, Mesh3D, TorusKnotGeometry, createRaycastHit3D } from '@pixi/3d';
import { frame } from 'benchy';

import type { PixiStage } from './stage.ts';

const PARTS = 8;
const CASTS = 32;

frame('picking', {
  variants: {
    'outer-first': { innerFirst: false },
    'inner-first': { innerFirst: true },
  },
  primary: 'cpu.update',
  create({ view, rng }: PixiStage, { innerFirst }) {
    const halfHeight = view.camera.position.z * Math.tan((view.camera.fov * Math.PI) / 360);
    const outerScale = halfHeight * 0.4;

    const geometry = new TorusKnotGeometry({ tubularSegments: 256, radialSegments: 12 });
    const material = new Material3D({ baseColor: 0xd94f9e });
    for (let i = 0; i < PARTS; i++) {
      const part = innerFirst ? PARTS - 1 - i : i;
      const mesh = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
      mesh.scale.set(outerScale * (1 - (0.4 * part) / (PARTS - 1)));
      mesh.rotation.set(0.6, 0.4, 0);
      mesh.eventMode = 'static';
      mesh.hitVolume = 'geometry';
      view.root.addChild(mesh);
    }

    const reach = ((1.9 * outerScale) / halfHeight) * (view.height / 2);
    const points = Array.from({ length: CASTS }, () => ({
      x: view.width / 2 + rng.range(-reach, reach),
      y: view.height / 2 + rng.range(-reach, reach),
    }));
    const hit = createRaycastHit3D();

    return {
      simulate() {},
      update() {
        for (let i = 0; i < CASTS; i++) view.raycast(points[i]!, hit);
      },
      destroy() {
        geometry.destroy();
        material.destroy();
      },
    };
  },
});
