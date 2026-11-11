import { captureWarnings, expectCleanRender, getApp } from '@test-utils';
import { Texture, TexturePool } from 'pixi.js';
import type { Renderer, TextureSource, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { TintEffect } from '~/extras/post-processing/effects/TintEffect';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const WIDTH = 200;
const HEIGHT = 160;

function glass(): Mesh3D {
  return new Mesh3D({
    geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 0.2 }),
    material: new Material3D({ transmission: { factor: 1, thickness: 0.5 }, ior: 1.5, roughness: 0.6 }),
  });
}

function destroyedWhileBound(warnings: string[]): string[] {
  return warnings.filter((w) => w.includes('destroyed while still bound'));
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`transient release on pool evict (${preference})`, () => {
    it("puts the placeholder back before a resize destroys an idle pass's pooled texture", async () => {
      const app = await getApp<Renderer>({
        id: `transient-evict-${preference}`,
        appOptions: { preference, width: WIDTH, height: HEIGHT, useBackBuffer: true },
      });
      try {
        const view = new View3D({ width: WIDTH, height: HEIGHT });
        view.camera.position.z = 4;
        view.camera.lookAt({ x: 0, y: 0, z: 0 });
        const mesh = glass();
        view.root.addChild(mesh);
        app.stage.addChild(view);

        await expectCleanRender(app);
        const { globalBindGroup: bindGroup, globalTextureBindings } = view._gpuData[app.renderer.uid];
        const slot = globalTextureBindings.opaqueColor.slot;
        const copy = bindGroup.getResource(slot) as TextureSource;
        expect(copy).not.toBe(Texture.EMPTY.source);

        view.root.removeChild(mesh);
        await expectCleanRender(app);
        expect(bindGroup.getResource(slot), 'the idle transmission pass slot still holds the copy').toBe(copy);

        const warnings = captureWarnings(() => app.renderer.resize(WIDTH + 40, HEIGHT + 40));
        expect(copy.destroyed, 'the resize pruned the old canvas-sized pool bucket').toBe(true);
        expect(bindGroup.getResource(slot), 'the graph let go of the copy before the pool destroyed it').toBe(
          Texture.EMPTY.source,
        );
        expect(destroyedWhileBound(warnings)).toEqual([]);

        await expectCleanRender(app);

        view.root.addChild(mesh);
        await expectCleanRender(app);
        const fresh = bindGroup.getResource(slot) as TextureSource;
        expect(fresh, 'with the glass back, the pass binds a fresh copy').not.toBe(Texture.EMPTY.source);
        expect(fresh.destroyed).toBe(false);
      } finally {
        app.destroy(true);
      }
    });

    it("lets go of the old graph's pooled textures when the pass list changes before a resize", async () => {
      const app = await getApp<Renderer>({
        id: `transient-evict-rebuild-${preference}`,
        appOptions: { preference, width: WIDTH, height: HEIGHT, useBackBuffer: true },
      });
      try {
        const view = new View3D({ width: WIDTH, height: HEIGHT, passes: [new TintEffect()] });
        view.camera.position.z = 4;
        view.camera.lookAt({ x: 0, y: 0, z: 0 });
        view.root.addChild(glass());
        app.stage.addChild(view);

        await expectCleanRender(app);
        await expectCleanRender(app);

        view.passes = [];
        const warnings = captureWarnings(() => app.renderer.resize(WIDTH + 40, HEIGHT + 40));
        expect(destroyedWhileBound(warnings)).toEqual([]);

        await expectCleanRender(app);
        await expectCleanRender(app);
      } finally {
        app.destroy(true);
      }
    });

    it("releases the output and fullscreen passes' pooled inputs before a resize destroys them", async () => {
      const app = await getApp<Renderer>({
        id: `transient-evict-passes-${preference}`,
        appOptions: { preference, width: WIDTH, height: HEIGHT, useBackBuffer: true },
      });
      try {
        const view = new View3D({ width: WIDTH, height: HEIGHT, composite: true, passes: [new TintEffect()] });
        view.camera.position.z = 4;
        view.camera.lookAt({ x: 0, y: 0, z: 0 });
        view.root.addChild(glass());
        const composited = new View3D({ width: WIDTH, height: HEIGHT, composite: true });
        composited.camera.position.z = 4;
        composited.camera.lookAt({ x: 0, y: 0, z: 0 });
        composited.root.addChild(glass());
        app.stage.addChild(view, composited);

        await expectCleanRender(app);
        await expectCleanRender(app);

        const warnings = captureWarnings(() => app.renderer.resize(WIDTH + 40, HEIGHT + 40));
        expect(destroyedWhileBound(warnings)).toEqual([]);

        const device = (app.renderer as WebGPURenderer).gpu?.device;
        device?.pushErrorScope('validation');
        const afterResize = captureWarnings(() => app.renderer.render(app.stage));
        const error = device ? await device.popErrorScope() : null;
        expect(error?.message ?? null, 'the frame after the resize draws with fresh textures').toBe(null);
        expect(destroyedWhileBound(afterResize)).toEqual([]);
      } finally {
        app.destroy(true);
      }
    });

    it('destroys the global group on unload, so a resize cannot find a pooled texture still bound', async () => {
      const app = await getApp<Renderer>({
        id: `transient-evict-unload-${preference}`,
        appOptions: { preference, width: WIDTH, height: HEIGHT, useBackBuffer: true },
      });
      try {
        const view = new View3D({ width: WIDTH, height: HEIGHT });
        view.camera.position.z = 4;
        view.camera.lookAt({ x: 0, y: 0, z: 0 });
        view.root.addChild(glass());
        app.stage.addChild(view);

        await expectCleanRender(app);
        const { globalBindGroup: first, globalTextureBindings } = view._gpuData[app.renderer.uid];
        const slot = globalTextureBindings.opaqueColor.slot;

        view.unload();
        expect(first.resources).toBeNull();
        const warnings = captureWarnings(() => app.renderer.resize(WIDTH + 40, HEIGHT + 40));
        expect(destroyedWhileBound(warnings)).toEqual([]);

        await expectCleanRender(app);
        const second = view._gpuData[app.renderer.uid].globalBindGroup;
        expect(second).not.toBe(first);
        const copy = second.getResource(slot) as TextureSource;
        expect(copy, 'the pass bound a fresh copy into the new group').not.toBe(Texture.EMPTY.source);
        expect(copy.destroyed).toBe(false);
      } finally {
        app.destroy(true);
      }
    });

    it('adds no pool listener per view or pass, and the renderer takes its own away when destroyed', async () => {
      const baseline = TexturePool.listenerCount('evict');
      const app = await getApp<Renderer>({
        id: `transient-evict-listeners-${preference}`,
        appOptions: { preference, width: WIDTH, height: HEIGHT, useBackBuffer: true },
      });
      const withRenderer = TexturePool.listenerCount('evict');
      const view = new View3D({ width: WIDTH, height: HEIGHT, passes: [new TintEffect()] });
      const composited = new View3D({ width: WIDTH, height: HEIGHT, composite: true });
      for (const v of [view, composited]) {
        v.camera.position.z = 4;
        v.camera.lookAt({ x: 0, y: 0, z: 0 });
        v.root.addChild(glass());
      }
      try {
        app.stage.addChild(view, composited);
        await expectCleanRender(app);
        const withViews = TexturePool.listenerCount('evict');

        const warnings = captureWarnings(() => app.destroy(true));
        expect(withViews, 'views and their passes add no listener').toBe(withRenderer);
        expect(destroyedWhileBound(warnings)).toEqual([]);
        expect(TexturePool.listenerCount('evict'), 'nothing listens once the renderer is gone').toBe(baseline);
      } finally {
        view.destroy();
        composited.destroy();
      }
    });
  });
}
