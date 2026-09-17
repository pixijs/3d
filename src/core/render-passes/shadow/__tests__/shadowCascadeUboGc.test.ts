import { getApp, isCI } from '@test-utils';
import type { Application, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { CascadeSlot } from '~/core/render-passes/shadow/shadowPassUtils';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

function buildScene(app: Application<WebGPURenderer>): { view3d: View3D; sun: DirectionalLight } {
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

  return { view3d, sun };
}

// A cascade's camera group is baked into that cascade's recorded render bundle, which replays
// without re-fetching it. A throttled cascade never re-uploads, so pixi's GC would see an idle
// buffer and unload it out from under the live bundle. WebGPU-only: WebGL uploads per draw.
describe.skipIf(isCI)('cascade uniform buffers (webgpu)', () => {
  it('are realized eagerly and exempted from renderer garbage collection', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'shadow-cascade-ubo-gc',
      appOptions: { preference: 'webgpu', width: SIZE, height: SIZE },
    });

    try {
      const { view3d, sun } = buildScene(app);
      app.render();

      const cascades = sun._gpuShadowData!.cascades as CascadeSlot[];
      expect(cascades.length).toBeGreaterThan(1);

      const buffers = cascades.map((cascade) => cascade.cameraData.uniformGroup.buffer!);
      expect(buffers.map((buffer) => buffer.autoGarbageCollect)).toEqual(buffers.map(() => false));

      // Exempt means nothing else will ever collect them, so detaching the light has to free them
      // itself — otherwise attach/detach churn leaks one uniform buffer per cascade per cycle.
      view3d.root.removeChild(sun);
      expect(buffers.map((buffer) => buffer.destroyed)).toEqual(buffers.map(() => true));
    } finally {
      app.destroy();
    }
  });
});
