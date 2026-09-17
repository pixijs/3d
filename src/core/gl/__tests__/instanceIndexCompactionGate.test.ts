import { getApp } from '@test-utils';
import type { WebGLRenderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

// The visibility-only compaction is dirty-gated: its answer can only change when something is
// hidden or shown, so a clean frame must not re-walk the instances or re-upload the index
// texture. The visual scenes can't catch a broken gate — they assert pixels, and skipping work
// that produces identical pixels is invisible to them. So count the walks directly.
//
// A frustum producer is deliberately NOT gated (the camera has no change signal), which is why
// these scenes stay under the `'auto'` cull threshold so the producer resolves to `'off'`.

/** Spies on the batcher's private compaction and returns a per-frame call counter. */
function spyOnCompaction(renderer: WebGLRenderer) {
  const batcher = renderer.material3d.batcher as unknown as { _compact: (...args: unknown[]) => void };

  return vi.spyOn(batcher, '_compact');
}

function buildView(meshCount: number): { view3d: View3D; meshes: Mesh3D[] } {
  const view3d = new View3D({ width: 64, height: 64 });
  view3d.camera.position.set(0, 0, 8);

  const light = new DirectionalLight({ color: 0xffffff, intensity: 3 });
  light.rotation.set(0.4, 0.4, 0);
  view3d.root.addChild(light);

  const geometry = new CubeGeometry();
  const material = new Material3D({ baseColor: 0xff8844 });
  const meshes: Mesh3D[] = [];

  for (let i = 0; i < meshCount; i++) {
    const mesh = new Mesh3D({ geometry, material });
    mesh.position.set((i % 4) - 1.5, Math.floor(i / 4) - 1.5, 0);
    view3d.root.addChild(mesh);
    meshes.push(mesh);
  }

  return { view3d, meshes };
}

describe('WebGL instance-index compaction gate', () => {
  it('skips the compaction on frames where nothing was hidden or shown', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'gl-compaction-gate-clean',
      appOptions: { preference: 'webgl', width: 64, height: 64, backgroundColor: 0x000000 },
    });

    try {
      const { view3d } = buildView(8);
      app.stage.addChild(view3d);

      app.render();

      const compact = spyOnCompaction(app.renderer);

      // Three clean frames: no transforms, no visibility flips, no adds or removes.
      app.render();
      app.render();
      app.render();

      expect(compact).not.toHaveBeenCalled();
    } finally {
      app.destroy();
    }
  });

  it('re-walks on the frame a mesh is hidden, then settles again', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'gl-compaction-gate-visibility',
      appOptions: { preference: 'webgl', width: 64, height: 64, backgroundColor: 0x000000 },
    });

    try {
      const { view3d, meshes } = buildView(8);
      app.stage.addChild(view3d);

      app.render();

      const compact = spyOnCompaction(app.renderer);

      meshes[0].visible = false;
      app.render();
      const afterHide = compact.mock.calls.length;
      expect(afterHide).toBeGreaterThan(0);

      // The flip has been consumed — the next frame is clean again.
      app.render();
      expect(compact.mock.calls.length).toBe(afterHide);

      // Showing it again is another flip, so the walk has to run once more.
      meshes[0].visible = true;
      app.render();
      expect(compact.mock.calls.length).toBeGreaterThan(afterHide);
    } finally {
      app.destroy();
    }
  });

  it('re-walks after a structural rebuild', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'gl-compaction-gate-rebuild',
      appOptions: { preference: 'webgl', width: 64, height: 64, backgroundColor: 0x000000 },
    });

    try {
      const { view3d } = buildView(8);
      app.stage.addChild(view3d);

      app.render();

      const compact = spyOnCompaction(app.renderer);

      // A new mesh rebuilds the draw work, which invalidates the index the compaction reads
      // from — the walk must run even though no visibility flipped.
      const extra = new Mesh3D({ geometry: new CubeGeometry(), material: new Material3D({ baseColor: 0x44ff88 }) });
      extra.position.set(2.5, 0, 0);
      view3d.root.addChild(extra);

      app.render();

      expect(compact).toHaveBeenCalled();
    } finally {
      app.destroy();
    }
  });
});
