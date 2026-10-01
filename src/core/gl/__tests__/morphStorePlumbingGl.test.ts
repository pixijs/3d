import { getApp } from '@test-utils';
import type { WebGLRenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

describe('morph store plumbing (WebGL)', () => {
  it('allocates, packs and syncs the shared morph store and exposes its data texture on a WebGL app', async () => {
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

      expect(morph._slot, 'a weight slot is allocated').toBeGreaterThanOrEqual(0);
      expect(geometry._morphDeltaBase, 'the deltas are packed').toBeGreaterThanOrEqual(0);
      const weightsBase = (store as unknown as { _deltaCapacity: number })._deltaCapacity;
      expect(morph._weightIndex, 'the absolute weight offset is derived').toBe(weightsBase + morph._slot);

      expect(store.data[morph._weightIndex], 'the weight is diffed into the shared array').toBeCloseTo(0.25);

      const source = store.texture.source;
      expect(source.width * source.height * 4, 'the data texture covers the backing array exactly').toBe(
        store.data.length,
      );
    } finally {
      app.destroy();
    }
  });
});
