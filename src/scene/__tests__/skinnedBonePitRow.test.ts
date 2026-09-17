import { getApp } from '@test-utils';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { Skeleton } from '~/scene/Skeleton';
import { View3D } from '~/scene/View3D';

const SIZE = 64;
const JOINTS = 4;

/** A unit quad bound entirely to joint 0, so posing that joint moves the whole mesh. */
function skinnedQuad(): Mesh3D {
  const geometry = new Geometry3D({
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    joints: new Uint16Array(16),
    weights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  });

  const inverseBindMatrices = new Float32Array(JOINTS * 16);
  for (let i = 0; i < JOINTS; i++) {
    inverseBindMatrices.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], i * 16);
  }

  return new Mesh3D({
    geometry,
    material: new FlatMaterial({ baseColor: 0xff2200 }),
    skeleton: new Skeleton({
      parent: new Int16Array(JOINTS).fill(-1),
      joints: new Int16Array(JOINTS).map((_, i) => i),
      inverseBindMatrices,
    }),
  });
}

/** Pixels that differ from the view's clear colour — how much of the mesh is on screen. */
function drawnPixels(app: Application<Renderer>, view3d: View3D): number {
  const data = new Uint8Array(app.renderer.extract.pixels(view3d).pixels);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 32 || data[i + 1] > 32 || data[i + 2] > 32) n++;
  }
  return n;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`skinned mesh bone-pit row (${preference})`, () => {
    // Control for the test below: the same pose change, with nobody leaving the
    // pit. Proves the mesh really does animate out of shot in one frame, so a
    // failure there is the sibling's removal and not the posing itself.
    it('poses itself out of shot when the scene is otherwise untouched', async () => {
      const app = await getApp<Renderer>({
        id: `bone-pit-row-control-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x000000 },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 3);
        view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

        const sibling = skinnedQuad();
        sibling.position.set(-50, 0, 0);
        const subject = skinnedQuad();
        view3d.root.addChild(sibling);
        view3d.root.addChild(subject);

        app.render();
        expect(drawnPixels(app, view3d)).toBeGreaterThan(0);

        subject.skeleton!.setLocalTRS(0, 500, 0, 0, 0, 0, 0, 1);

        app.render();

        expect(drawnPixels(app, view3d)).toBe(0);

        view3d.destroy(true);
      } finally {
        app.destroy();
      }
    });

    it('keeps its own pose after a sibling skinned mesh leaves the scene', async () => {
      const app = await getApp<Renderer>({
        id: `bone-pit-row-sibling-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x000000 },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 3);
        view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

        // `sibling` is added first, so it takes the front of the bone pit and
        // pushes `subject` to a non-zero base.
        const sibling = skinnedQuad();
        sibling.position.set(-50, 0, 0);
        const subject = skinnedQuad();
        view3d.root.addChild(sibling);
        view3d.root.addChild(subject);

        app.render();
        expect(drawnPixels(app, view3d)).toBeGreaterThan(0);

        // The sibling leaves, which slides `subject` to the front of the pit …
        view3d.root.removeChild(sibling);
        // … and on the same frame `subject` poses itself out of shot. Its mesh
        // transform never changes — only the skeleton animates.
        subject.skeleton!.setLocalTRS(0, 500, 0, 0, 0, 0, 0, 1);

        app.render();

        expect(drawnPixels(app, view3d)).toBe(0);

        view3d.destroy(true);
      } finally {
        app.destroy();
      }
    });
  });
}
