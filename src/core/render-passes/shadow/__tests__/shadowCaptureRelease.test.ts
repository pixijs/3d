import { expectCleanRender, getApp } from '@test-utils';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { CullResult, CullResults } from '~/core/render-passes/CullResult';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { cascadeCountFor } from '~/core/render-passes/shadow/shadowPassUtils';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import type { Light, ShadowData } from '~/scene/lights/Light';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

function sun(): DirectionalLight {
  const light = new DirectionalLight({ color: 0xfff4e0, intensity: 4, castShadow: true });
  light.rotation.set((-55 * Math.PI) / 180, (55 * Math.PI) / 180, 0);
  return light;
}

function ground(): Mesh3D {
  const mesh = new Mesh3D({
    geometry: new PlaneGeometry({ width: 20, height: 20 }),
    material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
    castShadow: false,
  });
  mesh.position.set(0, -0.5, 0);
  mesh.rotation.set(-Math.PI / 2, 0, 0);
  return mesh;
}

function frame(view3d: View3D): void {
  view3d.camera.position.set(4, 6, 10);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
}

function pixels(app: Application<Renderer>, view3d: View3D): Uint8Array {
  return new Uint8Array(app.renderer.extract.pixels(view3d).pixels);
}

/** Count pixels whose colour differs by more than `tol` on any channel. */
function differingPixels(a: Uint8Array, b: Uint8Array, tol = 8): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > tol || Math.abs(a[i + 1] - b[i + 1]) > tol || Math.abs(a[i + 2] - b[i + 2]) > tol) {
      n++;
    }
  }
  return n;
}

/** Anything carrying pixi's GC idle clock — a buffer or a geometry. */
interface GcClocked {
  _gcLastUsed: number;
}

/** How many renderers hold a GPU copy of this resource — 0 once it has been collected. */
function gpuCopies(resource: { _gpuData: Record<number, unknown> }): number {
  let n = 0;
  for (const uid in resource._gpuData) {
    if (resource._gpuData[uid]) n++;
  }
  return n;
}

/** The map `CullResults` keys by batch uid — the one internal the release case reads. */
interface CullResultsProbe {
  _byBatch: Record<number, (CullResult | undefined)[]>;
}

/** The cull results a light's shadow data holds — WebGPU only; `undefined` on WebGL and after a release. */
function shadowCullResults(light: Light): CullResults | undefined {
  return (light._gpuShadowData as (ShadowData & { cullResults?: CullResults }) | null)?.cullResults;
}

/**
 * The GPU copies one cull result holds: its survivor records and its indirect draw args. Both are
 * `Buffer3D`s, exempt from pixi's GC, so nothing but an explicit unload ever frees them.
 */
function resultResidency(result: CullResult): number {
  return gpuCopies(result.survivors.buffer) + gpuCopies(result.indirectDrawData.drawCallsBuffer);
}

/** Sweep with a 1 s idle threshold after backdating `stale`'s clocks, so only those age out. */
function collectStale(renderer: Renderer, ...stale: GcClocked[]): void {
  const saved = renderer.gc.maxUnusedTime;
  renderer.gc.maxUnusedTime = 1000;
  for (const item of stale) item._gcLastUsed = performance.now() - 100_000;
  renderer.gc.run();
  renderer.gc.maxUnusedTime = saved;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`shadow capture lifecycle (${preference})`, () => {
    it('lets the last shadow build’s geometry age out once nothing casts, while the ground keeps the forward passes running', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-capture-cull-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'low' });
        app.stage.addChild(view3d);

        /** `dynamic` keeps it out of the shared atlas, so the buffers a shadow build captures are its own */
        const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1, dynamic: true });
        const caster = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0x4a7c59 }), castShadow: true });
        view3d.root.addChild(ground(), caster, sun());
        frame(view3d);

        app.render();
        app.render();
        const before = pixels(app, view3d);
        const pd = view3d._sceneBatch.drawLists[RenderPassBit.SHADOW];
        expect(pd.commandList.count).toBeGreaterThan(0);
        const buffers = geometry.buffers;
        expect(buffers.map((b) => gpuCopies(b) > 0)).toEqual(buffers.map(() => true));

        caster.removeFromParent();
        app.render();
        expect(pd.commandList.count, 'with no caster the shadow pass is skipped and its build empties').toBe(0);
        collectStale(app.renderer, geometry, ...buffers);
        expect(buffers.map(gpuCopies), "nothing keeps the geometry's buffers from ageing out").toEqual(
          buffers.map(() => 0),
        );

        view3d.root.addChild(caster);
        await expectCleanRender(app);
        app.render();
        expect(pd.commandList.count).toBeGreaterThan(0);
        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
      } finally {
        app.destroy();
      }
    });

    it('keeps the shadow list while the pass is culled and replays it when a casting light comes back', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-capture-light-return-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'low' });
        app.stage.addChild(view3d);

        const caster = new Mesh3D({
          geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 }),
          material: new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.5 }),
          castShadow: true,
        });
        const light = sun();
        view3d.root.addChild(ground(), caster, light);
        frame(view3d);

        app.render();
        const before = pixels(app, view3d);
        const pd = view3d._sceneBatch.drawLists[RenderPassBit.SHADOW];
        const built = pd.commandList.dirtyId;
        expect(pd.commandList.count).toBeGreaterThan(0);

        light.removeFromParent();
        app.render();
        expect(pd.commandList.count, 'skipped for want of a light, with its casters in place').toBeGreaterThan(0);
        expect(pd.commandList.dirtyId, 'nothing about the casters changed, so the list stays as built').toBe(built);

        view3d.root.addChild(light);
        app.render();

        expect(pd.commandList.dirtyId).toBe(built);
        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
      } finally {
        app.destroy();
      }
    });

    it('rebuilds a kept list whose geometry aged out while the pass was culled', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-capture-culled-gc-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'low' });
        app.stage.addChild(view3d);

        const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1, dynamic: true });
        const caster = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0x4a7c59 }), castShadow: true });
        const light = sun();
        view3d.root.addChild(ground(), caster, light);
        frame(view3d);

        app.render();
        app.render();
        const before = pixels(app, view3d);
        const pd = view3d._sceneBatch.drawLists[RenderPassBit.SHADOW];
        const built = pd.commandList.dirtyId;

        light.removeFromParent();
        app.render();
        const buffers = geometry.buffers;
        collectStale(app.renderer, geometry, ...buffers);
        expect(buffers.map(gpuCopies), 'the skipped pass keeps its list, but nothing replays it').toEqual(
          buffers.map(() => 0),
        );

        view3d.root.addChild(light);
        await expectCleanRender(app);
        expect(pd.commandList.dirtyId, 'losing the buffers marked the list stale, so it rebuilt').toBeGreaterThan(
          built,
        );
        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
      } finally {
        app.destroy();
      }
    });

    it('frees the cull results the light holds on unload and re-mints them next render', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-cull-result-unload-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'low' });
        app.stage.addChild(view3d);

        const caster = new Mesh3D({
          geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 }),
          material: new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.5 }),
          castShadow: true,
        });
        const light = sun();
        view3d.root.addChild(ground(), caster, light);
        frame(view3d);

        app.render();

        const cascadeCount = cascadeCountFor(light);
        const results = shadowCullResults(light);
        expect(
          results !== undefined,
          'WebGPU culls the scene batch per cascade into results on the light; WebGL holds none',
        ).toBe(preference === 'webgpu');

        const held: CullResult[] = [];
        for (let c = 0; c < cascadeCount; c++) {
          const result = results?.get(view3d._sceneBatch, c);
          expect(result !== undefined).toBe(preference === 'webgpu');
          if (result) held.push(result);
        }
        expect(held.length).toBe(preference === 'webgpu' ? cascadeCount : 0);
        expect(held.map(resultResidency), "both buffers of every cascade's result are resident").toEqual(
          held.map(() => 2),
        );
        expect(light._gpuShadowData).not.toBeNull();

        view3d.unload();

        expect(
          held.map(resultResidency),
          'a pooled result holds no GPU memory, or a warm pool would keep buffers no unload reaches',
        ).toEqual(held.map(() => 0));
        expect(
          Object.keys((results as unknown as CullResultsProbe | undefined)?._byBatch ?? {}),
          '`release()` empties the container',
        ).toEqual([]);
        expect(light._gpuShadowData, 'and the light drops the shadow data that held it').toBeNull();

        app.render();

        const reminted = shadowCullResults(light);
        expect(reminted !== undefined).toBe(preference === 'webgpu');
        const revived: CullResult[] = [];
        for (let c = 0; c < cascadeCount; c++) {
          const result = reminted?.get(view3d._sceneBatch, c);
          if (result) revived.push(result);
        }
        expect(revived.length).toBe(held.length);
        expect(revived.map(resultResidency), 'fresh results out of the pool, resident again').toEqual(
          held.map(() => 2),
        );
      } finally {
        app.destroy();
      }
    });
  });
}
