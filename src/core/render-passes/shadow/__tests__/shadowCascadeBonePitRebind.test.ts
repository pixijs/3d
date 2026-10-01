import { getApp, isCI } from '@test-utils';
import type { Application, BindGroup, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

/** Reaches the pit's private growth path — the production trigger needs >256 skinned joints. */
interface GrowableBonePit {
  _ensureCapacity(requiredBoneCount: number): void;
}

/** The shadow pass's own bind group, where the bone pit sits at slot 2 */
interface ShadowPassInternals {
  _globalBindGroup: BindGroup;
}

function buildScene(app: Application<WebGPURenderer>): View3D {
  const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'low' });
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

describe.skipIf(isCI)('cascade bone-pit binding in the WebGPU shadow pass bind group, which is created once', () => {
  it('re-points at the live bone-pit resource when growth replaces it, before the cascade bundles re-record', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'shadow-cascade-bone-pit',
      appOptions: { preference: 'webgpu', width: SIZE, height: SIZE },
    });

    try {
      const view3d = buildScene(app);
      app.render();

      const shadowBindGroup = (view3d.passByBit[RenderPassBit.SHADOW] as unknown as ShadowPassInternals)
        ._globalBindGroup;
      const staleResource = view3d._bonePit.bufferResource;
      expect(shadowBindGroup.getResource(2)).toBe(staleResource);

      (view3d._bonePit as unknown as GrowableBonePit)._ensureCapacity(4096);
      expect(view3d._bonePit.bufferResource).not.toBe(staleResource);

      app.render();

      expect(shadowBindGroup.getResource(2)).toBe(view3d._bonePit.bufferResource);
    } finally {
      app.destroy();
    }
  });
});
