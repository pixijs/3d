import { getApp } from '@test-utils';
import type { WebGLRenderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Spies on the batcher's private compaction, so a test can count the walks
 *
 * The visual scenes can't catch a broken gate: skipping work that gives identical pixels is
 * invisible to them.
 */
function spyOnCompaction(renderer: WebGLRenderer) {
  const batcher = renderer.material3d.batcher as unknown as { _compact: (...args: unknown[]) => void };

  return vi.spyOn(batcher, '_compact');
}

/**
 * A lit view of `meshCount` cubes, few enough that the `'auto'` cull mode resolves to `'off'`:
 * frustum culling compacts every frame by design, so only the visibility-only walk is gated
 */
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

      app.render();
      expect(compact.mock.calls.length, 'the flip was consumed, so the next frame is clean').toBe(afterHide);

      meshes[0].visible = true;
      app.render();
      expect(compact.mock.calls.length, 'showing it again is another flip').toBeGreaterThan(afterHide);
    } finally {
      app.destroy();
    }
  });

  it('re-walks after a structural rebuild, though no visibility flipped', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'gl-compaction-gate-rebuild',
      appOptions: { preference: 'webgl', width: 64, height: 64, backgroundColor: 0x000000 },
    });

    try {
      const { view3d } = buildView(8);
      app.stage.addChild(view3d);

      app.render();

      const compact = spyOnCompaction(app.renderer);

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
