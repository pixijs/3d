import { getApp } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import { RenderPassBit } from '../RenderPass';

// A pass-descriptor pass (shadow, outline, custom) compiles its own shader rather than
// taking the material's, and that compile folds in the geometry it was handed — vertex
// formats, morph targets, and the resolved topology. The entry is cached, so it has to
// re-resolve when the mesh swaps either half of the (geometry, material) pair it was
// built from, or the pass keeps drawing whatever the mesh happened to hold first.

const triangle = (topology?: 'triangle-list' | 'line-list'): Geometry3D =>
  new Geometry3D({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    topology,
  });

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`pass-descriptor cache (${preference})`, () => {
    it('re-resolves the entry when the geometry moves', async () => {
      const app = await getApp<Renderer>({
        id: `pass-descriptor-geometry-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 5);

        const geomA = triangle();
        const geomB = triangle('line-list');
        const mesh = new Mesh3D({ geometry: geomA, material: new Material3D({ baseColor: 0xffffff }) });
        view3d.root.addChild(mesh);

        app.render();

        const before = mesh._passCache[RenderPassBit.SHADOW];
        expect(before).toBeDefined();
        expect(before.topology).toBe('triangle-list');
        expect(before.lastGeometryUid).toBe(geomA.uid);
        const batchKey = before.batchKey;

        mesh.geometry = geomB;
        app.render();

        const after = mesh._passCache[RenderPassBit.SHADOW];
        expect(after.lastGeometryUid).toBe(geomB.uid);
        expect(after.topology).toBe('line-list');
        expect(after.batchKey).not.toBe(batchKey);
      } finally {
        app.destroy();
      }
    });

    it('re-resolves the entry when the material moves, and holds still otherwise', async () => {
      const app = await getApp<Renderer>({
        id: `pass-descriptor-material-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 5);

        const materialA = new Material3D({ baseColor: 0xff0000 });
        const materialB = new Material3D({ baseColor: 0x00ff00 });
        const mesh = new Mesh3D({ geometry: triangle(), material: materialA });
        view3d.root.addChild(mesh);

        app.render();

        const first = mesh._passCache[RenderPassBit.SHADOW];
        expect(first.lastMaterialUid).toBe(materialA.uid);

        // Nothing moved — a re-dirty must reuse the entry rather than recompile.
        mesh.invalidate();
        app.render();
        expect(mesh._passCache[RenderPassBit.SHADOW]).toBe(first);

        mesh.material = materialB;
        app.render();

        // Refreshed in place rather than replaced, so nothing holding the entry goes stale.
        const second = mesh._passCache[RenderPassBit.SHADOW];
        expect(second).toBe(first);
        expect(second.lastMaterialUid).toBe(materialB.uid);
      } finally {
        app.destroy();
      }
    });
  });
}
