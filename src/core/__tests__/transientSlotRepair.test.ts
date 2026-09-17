import { captureWarnings, getApp } from '@test-utils';
import { Texture } from 'pixi.js';
import type { BindGroup, Renderer, TextureSource, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { View3DPipe } from '~/core/View3DPipe';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/*
 * A pass that is off this frame still owns slots in the view's global bind group, and the pooled
 * texture they point at can be destroyed under it: a canvas resize prunes the pool buckets the old
 * canvas size was keeping. The graph must put the placeholder back before anything draws, and on
 * WebGPU re-record the bundles that baked the dead texture.
 *
 * The sequence: glass on screen (the transmission pass samples the opaque copy), glass gone (the
 * pass is off, its slot keeps the copy), canvas resized (the copy's bucket is pruned), render.
 */

const WIDTH = 200;
const HEIGHT = 160;

/** Renders one frame, failing on any WebGPU validation error the frame raised. */
async function renderClean(app: Awaited<ReturnType<typeof getApp<Renderer>>>): Promise<void> {
  const device = (app.renderer as WebGPURenderer).gpu?.device;
  device?.pushErrorScope('validation');
  app.renderer.render(app.stage);
  const error = device ? await device.popErrorScope() : null;
  expect(error?.message ?? null).toBe(null);
}

function glass(): Mesh3D {
  return new Mesh3D({
    geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 0.2 }),
    material: new Material3D({ transmission: { factor: 1, thickness: 0.5 }, ior: 1.5, roughness: 0.6 }),
  });
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`transient sample slot repair (${preference})`, () => {
    it('survives the pool destroying a texture an idle pass still had bound', async () => {
      const app = await getApp<Renderer>({
        id: `slot-repair-${preference}`,
        appOptions: { preference, width: WIDTH, height: HEIGHT, useBackBuffer: true },
      });
      try {
        const pipe = (app.renderer.renderPipes as unknown as { view3d: View3DPipe }).view3d;
        const slot = pipe.globalSlots.opaqueColor;
        // Full-canvas, so the opaque copy lands in a canvas-sized bucket, the kind a resize prunes.
        const view = new View3D({ width: WIDTH, height: HEIGHT });
        view.camera.position.z = 4;
        view.camera.lookAt({ x: 0, y: 0, z: 0 });
        const mesh = glass();
        view.root.addChild(mesh);
        app.stage.addChild(view);

        await renderClean(app);
        const bindGroup = (view._gpuData[app.renderer.uid] as unknown as { globalBindGroup: BindGroup })
          .globalBindGroup;
        const copy = bindGroup.getResource(slot) as TextureSource;
        expect(copy).not.toBe(Texture.EMPTY.source);

        // The transmission pass is now off; nothing rebinds its slot, which still holds the copy.
        view.root.removeChild(mesh);
        await renderClean(app);
        expect(bindGroup.getResource(slot)).toBe(copy);

        // ViewSystem updates TexturePool on canvas resize, which prunes the old screen-sized
        // bucket immediately. The graph then puts EMPTY back before anything draws.
        const device = (app.renderer as WebGPURenderer).gpu?.device;
        device?.pushErrorScope('validation');
        const warnings = captureWarnings(() => {
          app.renderer.resize(WIDTH + 40, HEIGHT + 40);
          app.renderer.render(app.stage);
        });
        const error = device ? await device.popErrorScope() : null;
        expect(error?.message ?? null).toBe(null);
        expect(copy.destroyed).toBe(true);
        expect(bindGroup.getResource(slot)).toBe(Texture.EMPTY.source);
        // pixi flags the destroy-while-bound in debug builds; that is the case being repaired.
        expect(warnings.some((w) => w.includes('destroyed while still bound'))).toBe(true);

        // Glass back: the pass runs again and binds a fresh copy.
        view.root.addChild(mesh);
        await renderClean(app);
        const fresh = bindGroup.getResource(slot) as TextureSource;
        expect(fresh).not.toBe(Texture.EMPTY.source);
        expect(fresh.destroyed).toBe(false);
      } finally {
        app.destroy(true);
      }
    });
  });
}
