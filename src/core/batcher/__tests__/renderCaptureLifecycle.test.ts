import { expectCleanRender, getApp } from '@test-utils';
import { CanvasSource, Texture } from 'pixi.js';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { MAX_BATCH_TEXTURES } from '~/core/batcher/batchConstants';
import type { DrawCommandList } from '~/core/batcher/DrawCommandList';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/** A collectable texture — pixi only auto-collects sources that opt in (image sources do). */
function makeCollectableTexture(color: string): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 4, 4);

  const texture = new Texture({ source: new CanvasSource({ resource: canvas }) });
  texture.source.autoGarbageCollect = true;
  return texture;
}

/**
 * Frames the scene and lights it; without a light every PBR surface renders black and a frame
 * comparison would pass on two black images
 */
function lightAndFrame(view3d: View3D): void {
  const sun = new DirectionalLight({ color: 0xffffff, intensity: 4 });
  sun.rotation.set((-45 * Math.PI) / 180, (35 * Math.PI) / 180, 0);
  view3d.root.addChild(sun);
  view3d.camera.fov = 50;
  view3d.camera.position.set(3, 4, 7);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
}

/** A sparse grid of the rendered frame — enough to tell a correct frame from a broken one. */
function readPixels(app: Application<Renderer>, view3d: View3D): number[] {
  const { pixels, width, height } = app.renderer.extract.pixels(view3d);
  const samples: number[] = [];
  for (let y = 8; y < height; y += 16) {
    for (let x = 8; x < width; x += 16) {
      const i = (y * width + x) * 4;
      samples.push(pixels[i], pixels[i + 1], pixels[i + 2]);
    }
  }
  return samples;
}

/** Anything carrying pixi's GC idle clock — a texture source, a buffer, or a geometry. */
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

/** Makes `resources` look idle by any threshold — unless a frame stamps them again. */
function backdate(...resources: GcClocked[]): void {
  for (const resource of resources) resource._gcLastUsed = performance.now() - 100_000;
}

/**
 * Sweep with a 1 s idle threshold after backdating `stale`'s clocks, so only those age out and
 * everything the last frame touched survives.
 */
function collectStale(renderer: Renderer, ...stale: GcClocked[]): void {
  const saved = renderer.gc.maxUnusedTime;
  renderer.gc.maxUnusedTime = 1000;
  backdate(...stale);
  renderer.gc.run();
  renderer.gc.maxUnusedTime = saved;
}

/** The list's capture map, reached for its size and membership. */
function captures(list: DrawCommandList): Map<unknown, unknown> {
  return (list as unknown as { _captures: Map<unknown, unknown> })._captures;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`render capture lifecycle (${preference})`, () => {
    it('keeps a drawn texture on the GPU through a sweep and lets it age out once nothing draws it', async () => {
      const app = await getApp<Renderer>({
        id: `capture-textures-${preference}`,
        appOptions: { preference, width: 128, height: 128, backgroundColor: 0x000000 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);
        lightAndFrame(view3d);

        const geometry = new CubeGeometry({ width: 2, height: 2, depth: 2 });
        const texture = makeCollectableTexture('#ff8800');
        const mesh = new Mesh3D({
          geometry,
          material: new Material3D({ baseColorTexture: texture, metallic: 0, roughness: 0.5 }),
        });
        /** Untextured, it keeps the view non-empty, so removing the textured mesh is a plain rebuild */
        const keeper = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0xffffff }) });
        keeper.position.set(0, -3, 0);
        view3d.root.addChild(mesh, keeper);

        app.render();
        const before = readPixels(app, view3d);
        expect(before.some((channel) => channel > 0)).toBe(true);
        expect(gpuCopies(texture.source)).toBeGreaterThan(0);

        backdate(texture.source);
        app.render();
        collectStale(app.renderer);
        expect(
          gpuCopies(texture.source),
          'the frame stamps the texture, though a recorded bundle binds nothing',
        ).toBeGreaterThan(0);
        await expectCleanRender(app);
        expect(readPixels(app, view3d)).toEqual(before);

        mesh.removeFromParent();
        app.render();
        collectStale(app.renderer, texture.source);
        expect(gpuCopies(texture.source), 'nothing draws it, so it ages out like any idle texture').toBe(0);

        view3d.root.addChild(mesh);
        await expectCleanRender(app);
        expect(gpuCopies(texture.source), 'drawn again, it comes back').toBeGreaterThan(0);
        expect(readPixels(app, view3d)).toEqual(before);
      } finally {
        app.destroy();
      }
    });

    it('lets an emptied view’s textures age out and rebuilds when it fills again', async () => {
      const app = await getApp<Renderer>({
        id: `capture-empty-view-${preference}`,
        appOptions: { preference, width: 128, height: 128, backgroundColor: 0x000000 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);
        lightAndFrame(view3d);

        const texture = makeCollectableTexture('#22cc55');
        const mesh = new Mesh3D({
          geometry: new CubeGeometry({ width: 2, height: 2, depth: 2 }),
          material: new Material3D({ baseColorTexture: texture, metallic: 0, roughness: 0.5 }),
        });
        view3d.root.addChild(mesh);

        app.render();
        const before = readPixels(app, view3d);
        expect(before.some((channel) => channel > 0)).toBe(true);

        mesh.removeFromParent();
        app.render();
        collectStale(app.renderer, texture.source);
        expect(
          gpuCopies(texture.source),
          "an empty view skips its render, and its lingering build doesn't keep the texture",
        ).toBe(0);

        view3d.root.addChild(mesh);
        await expectCleanRender(app);
        expect(readPixels(app, view3d)).toEqual(before);
      } finally {
        app.destroy();
      }
    });

    it('survives a live batch texture being unloaded and re-uploads it', async () => {
      const app = await getApp<Renderer>({
        id: `capture-texture-unload-${preference}`,
        appOptions: { preference, width: 128, height: 128, backgroundColor: 0x000000 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);

        lightAndFrame(view3d);
        const texture = makeCollectableTexture('#ff8800');
        const mesh = new Mesh3D({
          geometry: new CubeGeometry({ width: 2, height: 2, depth: 2 }),
          material: new Material3D({ baseColorTexture: texture, metallic: 0, roughness: 0.5 }),
        });
        view3d.root.addChild(mesh);

        app.render();
        const before = readPixels(app, view3d);
        expect(before.some((channel) => channel > 0)).toBe(true);
        const pd = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
        const drawDirtyId = pd.drawDirtyId;

        texture.source.unload();
        expect(pd.drawDirtyId, 'losing a source the build holds forces a rebuild').toBeGreaterThan(drawDirtyId);

        await expectCleanRender(app);
        expect(readPixels(app, view3d)).toEqual(before);
      } finally {
        app.destroy();
      }
    });

    it('keeps a drawn dynamic geometry’s buffers through a sweep and lets them age out after removal', async () => {
      const app = await getApp<Renderer>({
        id: `capture-dynamic-geometry-${preference}`,
        appOptions: { preference, width: 128, height: 128, backgroundColor: 0x000000 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);
        lightAndFrame(view3d);

        /** Dynamic, so it stays out of the shared atlas and the buffers drawn are its own */
        const geometry = new CubeGeometry({ width: 2, height: 2, depth: 2, dynamic: true });
        const mesh = new Mesh3D({
          geometry,
          material: new Material3D({ baseColor: 0xff0000, metallic: 0, roughness: 0.5 }),
        });
        view3d.root.addChild(mesh);

        app.render();
        const before = readPixels(app, view3d);
        expect(before.some((channel) => channel > 0)).toBe(true);
        const buffers = geometry.buffers;
        expect(buffers.map((b) => gpuCopies(b) > 0)).toEqual(buffers.map(() => true));

        backdate(...buffers);
        app.render();
        collectStale(app.renderer);
        expect(
          buffers.map((b) => gpuCopies(b) > 0),
          'the replay stamps every buffer it holds',
        ).toEqual(buffers.map(() => true));
        await expectCleanRender(app);
        expect(readPixels(app, view3d)).toEqual(before);

        mesh.removeFromParent();
        app.render();
        collectStale(app.renderer, geometry, ...buffers);
        expect(
          buffers.map(gpuCopies),
          "once removed, nothing keeps the buffers or the geometry's recorded layout alive",
        ).toEqual(buffers.map(() => 0));

        view3d.root.addChild(mesh);
        await expectCleanRender(app);
        expect(readPixels(app, view3d)).toEqual(before);
      } finally {
        app.destroy();
      }
    });

    it('rebuilds after a drawn geometry buffer grows in place', async () => {
      const app = await getApp<Renderer>({
        id: `capture-buffer-growth-${preference}`,
        appOptions: { preference, width: 128, height: 128, backgroundColor: 0x000000 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);

        lightAndFrame(view3d);
        const geometry = new CubeGeometry({ width: 2, height: 2, depth: 2, dynamic: true });
        const mesh = new Mesh3D({
          geometry,
          material: new Material3D({ baseColor: 0x00ff00, metallic: 0, roughness: 0.5 }),
        });
        view3d.root.addChild(mesh);

        app.render();
        const before = readPixels(app, view3d);
        expect(before.some((channel) => channel > 0)).toBe(true);
        const pd = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
        const drawDirtyId = pd.drawDirtyId;

        const positions = geometry.getBuffer('aPosition');
        const grown = new Float32Array((positions.data as Float32Array).length + 9);
        grown.set(positions.data as Float32Array);
        positions.data = grown;
        expect(
          pd.drawDirtyId,
          'growth puts a new GPU buffer behind the same pixi Buffer, so the build that holds the old one goes',
        ).toBeGreaterThan(drawDirtyId);

        await expectCleanRender(app);
        expect(readPixels(app, view3d), 'the extra vertices are unindexed').toEqual(before);
      } finally {
        app.destroy();
      }
    });

    it('rebuilds, and re-records the geometry layout, when a drawn buffer is unloaded', async () => {
      const app = await getApp<Renderer>({
        id: `capture-buffer-unload-${preference}`,
        appOptions: { preference, width: 128, height: 128, backgroundColor: 0x000000 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);

        lightAndFrame(view3d);
        const geometry = new CubeGeometry({ width: 2, height: 2, depth: 2, dynamic: true });
        const mesh = new Mesh3D({
          geometry,
          material: new Material3D({ baseColor: 0x00ff00, metallic: 0, roughness: 0.5 }),
        });
        view3d.root.addChild(mesh);

        app.render();
        const before = readPixels(app, view3d);
        expect(before.some((channel) => channel > 0)).toBe(true);

        const positions = geometry.getBuffer('aPosition');
        const original = positions.data as Float32Array;
        const shifted = original.map((v, i) => (i % 3 === 0 ? v + 1.5 : v));
        positions.data = shifted;
        app.render();
        /** The cube shifted along x, drawn through the ordinary update path */
        const moved = readPixels(app, view3d);
        expect(moved).not.toEqual(before);
        positions.data = original;
        app.render();
        expect(readPixels(app, view3d)).toEqual(before);

        const pd = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
        const drawDirtyId = pd.drawDirtyId;
        positions.unload();
        expect(pd.drawDirtyId, 'unloading a buffer the build holds marks it stale').toBeGreaterThan(drawDirtyId);
        await expectCleanRender(app);
        expect(readPixels(app, view3d)).toEqual(before);

        positions.data = shifted;
        app.render();
        expect(
          readPixels(app, view3d),
          'the recorded layout reads the re-created buffer; a stale WebGL VAO would miss this update',
        ).toEqual(moved);
      } finally {
        app.destroy();
      }
    });

    it('keeps a batched mesh’s build while it is out of the view and gives it back on unload', async () => {
      const app = await getApp<Renderer>({
        id: `capture-batch-detach-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);
        lightAndFrame(view3d);

        const texture = makeCollectableTexture('#3355ff');
        const batched = new BatchedMesh3D({ size: 1 });
        batched.setGeometryAt(0, new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 }));
        batched.setMaterialAt(0, new Material3D({ baseColorTexture: texture }));
        batched.setMatrixAt(0, new Matrix4());
        batched.setItemActive(0, RenderPassBit.OPAQUE);
        view3d.root.addChild(batched);

        app.render();
        app.render();
        const attached = readPixels(app, view3d);
        const pd = batched.batch.drawLists[RenderPassBit.OPAQUE];
        expect(pd.commandList.count).toBeGreaterThan(0);
        const builtId = pd.commandList.dirtyId;

        batched.removeFromParent();
        app.render();
        expect(pd.commandList.count).toBeGreaterThan(0);
        expect(readPixels(app, view3d)).not.toEqual(attached);

        view3d.root.addChild(batched);
        await expectCleanRender(app);
        expect(
          pd.commandList.dirtyId,
          'added back, the batch replays its kept build, since reparenting is a detach and an attach in one call',
        ).toBe(builtId);
        expect(readPixels(app, view3d)).toEqual(attached);

        batched.removeFromParent();
        app.render();
        collectStale(app.renderer, texture.source);
        expect(gpuCopies(texture.source), 'while out of the view, nothing draws its texture').toBe(0);

        view3d.root.addChild(batched);
        await expectCleanRender(app);
        expect(pd.commandList.dirtyId, 'the kept build noticed the texture go and rebuilds').toBeGreaterThan(builtId);
        expect(readPixels(app, view3d)).toEqual(attached);

        batched.removeFromParent();
        batched.unload();
        expect(pd.commandList.count, "unload is what gives a detached batch's build back").toBe(0);

        view3d.root.addChild(batched);
        await expectCleanRender(app);
        expect(readPixels(app, view3d)).toEqual(attached);
      } finally {
        app.destroy();
      }
    });

    it('leaves nothing bound to a removed model’s textures once its build no longer needs them', async () => {
      const app = await getApp<Renderer>({
        id: `capture-bind-group-trim-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);
        lightAndFrame(view3d);

        const geometry = new CubeGeometry({ width: 0.5, height: 0.5, depth: 0.5 });
        /** One more texture than a bind group holds, so the build needs two groups */
        const textures = Array.from({ length: MAX_BATCH_TEXTURES + 1 }, (_, i) =>
          makeCollectableTexture(`hsl(${i * 30}, 80%, 50%)`),
        );
        const meshes = textures.map((texture, i) => {
          const mesh = new Mesh3D({ geometry, material: new Material3D({ baseColorTexture: texture }) });
          mesh.position.set(i - 5, 0, 0);
          return mesh;
        });
        /** Untextured, it keeps the view non-empty, so the removal is a rebuild that needs one group */
        const keeper = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0xffffff }) });
        keeper.position.set(0, -2, 0);
        view3d.root.addChild(keeper, ...meshes);
        app.render();

        view3d.root.removeChild(...meshes);
        app.render();

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          for (const texture of textures) texture.destroy(true);
          expect(
            warn.mock.calls.filter((call) => String(call[1]).includes('BindGroup')),
            'pixi warns when a destroyed source is still in a bind group',
          ).toEqual([]);
        } finally {
          warn.mockRestore();
        }
      } finally {
        app.destroy();
      }
    });

    it('rebuilding the transparent pass every frame adds no listeners and no captures', async () => {
      const app = await getApp<Renderer>({
        id: `capture-always-rebuild-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);
        lightAndFrame(view3d);

        const texture = makeCollectableTexture('#ff8800');
        const mesh = new Mesh3D({
          geometry: new CubeGeometry({ width: 2, height: 2, depth: 2 }),
          material: new Material3D({ baseColorTexture: texture, alphaMode: 'blend' }),
        });
        view3d.root.addChild(mesh);

        app.render();
        const pd = view3d._sceneBatch.drawLists[RenderPassBit.TRANSPARENT];
        expect(pd.commandList.count).toBeGreaterThan(0);
        expect(captures(pd.commandList).has(texture.source)).toBe(true);
        const captureCount = captures(pd.commandList).size;
        const listeners = texture.source.listenerCount('change');

        for (let i = 0; i < 5; i++) app.render();

        expect(texture.source.listenerCount('change')).toBe(listeners);
        expect(captures(pd.commandList).size).toBe(captureCount);
      } finally {
        app.destroy();
      }
    });
  });
}
