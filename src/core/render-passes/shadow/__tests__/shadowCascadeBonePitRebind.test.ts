import { expectCleanRender, getApp, isCI } from '@test-utils';
import type { Application, WebGPURenderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

interface GrowableBonePit {
  _ensureCapacity(requiredBoneCount: number): void;
}

function buildScene(app: Application<WebGPURenderer>): View3D {
  const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'low', cull: 'off' });
  app.stage.addChild(view3d);

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 20, height: 20 }),
    material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
    castShadow: false,
  });
  ground.position.set(0, -0.5, 0);
  ground.rotation.set(-Math.PI / 2, 0, 0);
  view3d.root.addChild(ground);

  const cube = new Mesh3D({
    geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
    material: new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.5 }),
    castShadow: true,
  });
  view3d.root.addChild(cube);

  const sun = new DirectionalLight({
    color: 0xfff4e0,
    intensity: 4,
    castShadow: true,
    shadow: { cascades: 2, maxDistance: 30 },
  });
  sun.rotation.set((-55 * Math.PI) / 180, (55 * Math.PI) / 180, 0);
  view3d.root.addChild(sun);

  view3d.camera.position.set(4, 6, 10);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  return view3d;
}

async function bundlesRecorded(app: Application<WebGPURenderer>, run: () => void | Promise<void>): Promise<number> {
  const spy = vi.spyOn(app.renderer.encoder, 'endBundle');
  try {
    await run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

describe.skipIf(isCI)('WebGPU cascade shadow bundles, which bake the bone pit through the global bind group', () => {
  it('record again against the live bone-pit buffer once growth replaces it', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'shadow-cascade-bone-pit',
      appOptions: { preference: 'webgpu', width: SIZE, height: SIZE },
    });

    try {
      const view3d = buildScene(app);
      const all = await bundlesRecorded(app, () => app.render());
      expect(all, 'two cascade bundles and at least one forward bundle').toBeGreaterThanOrEqual(3);
      expect(await bundlesRecorded(app, () => app.render()), 'a steady frame replays what it recorded').toBe(0);

      const { globalBindGroup } = view3d._gpuData[app.renderer.uid];
      const staleResource = view3d._bonePit.bufferResource;
      expect(globalBindGroup.getResource('uBonePitStorage')).toBe(staleResource);

      (view3d._bonePit as unknown as GrowableBonePit)._ensureCapacity(4096);
      expect(view3d._bonePit.bufferResource).not.toBe(staleResource);

      const afterGrowth = await bundlesRecorded(app, () => expectCleanRender(app));

      expect(globalBindGroup.getResource('uBonePitStorage')).toBe(view3d._bonePit.bufferResource);
      expect(afterGrowth, 'a bundle left alone keeps drawing from the retired buffer').toBe(all);
      expect(await bundlesRecorded(app, () => app.render()), 'growth re-records each bundle once').toBe(0);
    } finally {
      app.destroy();
    }
  });
});
