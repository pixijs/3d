import { captureWarnings, expectCleanRender, getApp } from '@test-utils';
import { Texture } from 'pixi.js';
import type { BindGroup, Renderer, TextureSource, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { View3DPipe } from '~/core/View3DPipe';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const WIDTH = 200;
const HEIGHT = 160;

/** A glass slab, which turns on the transmission pass and has it sample the opaque copy */
function glass(): Mesh3D {
  return new Mesh3D({
    geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 0.2 }),
    material: new Material3D({ transmission: { factor: 1, thickness: 0.5 }, ior: 1.5, roughness: 0.6 }),
  });
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`transient sample slot repair (${preference})`, () => {
    it("restores the placeholder before drawing when a resize destroys an idle pass's pooled texture", async () => {
      const app = await getApp<Renderer>({
        id: `slot-repair-${preference}`,
        appOptions: { preference, width: WIDTH, height: HEIGHT, useBackBuffer: true },
      });
      try {
        const pipe = (app.renderer.renderPipes as unknown as { view3d: View3DPipe }).view3d;
        const slot = pipe.globalSlots.opaqueColor;
        /** Full-canvas, so the opaque copy lands in a canvas-sized pool bucket, the kind a resize prunes */
        const view = new View3D({ width: WIDTH, height: HEIGHT });
        view.camera.position.z = 4;
        view.camera.lookAt({ x: 0, y: 0, z: 0 });
        const mesh = glass();
        view.root.addChild(mesh);
        app.stage.addChild(view);

        await expectCleanRender(app);
        const bindGroup = (view._gpuData[app.renderer.uid] as unknown as { globalBindGroup: BindGroup })
          .globalBindGroup;
        const copy = bindGroup.getResource(slot) as TextureSource;
        expect(copy).not.toBe(Texture.EMPTY.source);

        view.root.removeChild(mesh);
        await expectCleanRender(app);
        expect(bindGroup.getResource(slot), 'the idle transmission pass slot still holds the copy').toBe(copy);

        const device = (app.renderer as WebGPURenderer).gpu?.device;
        device?.pushErrorScope('validation');
        const warnings = captureWarnings(() => {
          app.renderer.resize(WIDTH + 40, HEIGHT + 40);
          app.renderer.render(app.stage);
        });
        const error = device ? await device.popErrorScope() : null;
        expect(error?.message ?? null, 'WebGPU re-recorded the bundles that baked the dead texture').toBe(null);
        expect(copy.destroyed, 'the resize pruned the old canvas-sized pool bucket').toBe(true);
        expect(bindGroup.getResource(slot), 'the graph put the placeholder back before drawing').toBe(
          Texture.EMPTY.source,
        );
        expect(
          warnings.some((w) => w.includes('destroyed while still bound')),
          'pixi warns about the destroy-while-bound being repaired',
        ).toBe(true);

        view.root.addChild(mesh);
        await expectCleanRender(app);
        const fresh = bindGroup.getResource(slot) as TextureSource;
        expect(fresh, 'with the glass back, the pass binds a fresh copy').not.toBe(Texture.EMPTY.source);
        expect(fresh.destroyed).toBe(false);
      } finally {
        app.destroy(true);
      }
    });
  });
}
