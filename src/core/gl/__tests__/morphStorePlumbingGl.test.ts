import { getApp } from '@test-utils';
import type { WebGLRenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

// The WebGL pipe owns the same shared morph store as WebGPU; sync() runs
// backend-neutrally, so slots, derived offsets, weight data, and the
// data-texture view the GL morph bits read must all be live on a webgl app.

describe('morph store plumbing (WebGL)', () => {
  it('runs the prepare pass and exposes the data-texture view', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'morph-gl-plumbing',
      appOptions: { preference: 'webgl', width: 128, height: 128 },
    });
    try {
      const view3d = new View3D({ width: 128, height: 128 });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 5);

      const geometry = new Geometry3D({
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        morphTargets: [{ positions: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]) }],
      });
      const mesh = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0xffffff }) });
      mesh.weights![0] = 0.25;
      view3d.root.addChild(mesh);

      app.render();

      const pipe = app.renderer.renderPipes.view3d;
      const store = pipe._morphStoreBuffer;
      const morph = mesh.morph!;

      // Slot allocated, deltas packed, and the absolute offset derived. (No
      // store-row assertion here: the GL scene batch doesn't mint store-buffer
      // rows — its batcher packs per-instance records instead, which is where
      // the morph lanes surface when the GL morph bits land.)
      expect(morph._slot).toBeGreaterThanOrEqual(0);
      expect(geometry._morphDeltaBase).toBeGreaterThanOrEqual(0);
      const weightsBase = (store as unknown as { _deltaCapacity: number })._deltaCapacity;
      expect(morph._weightIndex).toBe(weightsBase + morph._slot);

      // Weights diffed into the shared array.
      expect(store.data[morph._weightIndex]).toBeCloseTo(0.25);

      // The data-texture view exists (the pipe binds it every frame) and
      // exactly covers the backing array.
      const source = store.texture.source;
      expect(source.width * source.height * 4).toBe(store.data.length);
    } finally {
      app.destroy();
    }
  });
});
