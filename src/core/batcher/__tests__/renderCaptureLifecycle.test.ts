import { expectCleanRender, getApp } from '@test-utils';
import { CanvasSource, Texture, TextureStyle } from 'pixi.js';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { MERGE_THRESHOLD } from '~/core/batcher/batchConstants';
import type { DrawCommandList } from '~/core/batcher/DrawCommandList';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

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

function makeCheckerTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 2, 2);
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillRect(1, 1, 1, 1);
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

function lightAndFrame(view3d: View3D): void {
  const sun = new DirectionalLight({ color: 0xffffff, intensity: 4 });
  sun.rotation.set((-45 * Math.PI) / 180, (35 * Math.PI) / 180, 0);
  view3d.root.addChild(sun);
  view3d.camera.fov = 50;
  view3d.camera.position.set(3, 4, 7);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
}

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

interface GcClocked {
  _gcLastUsed: number;
}

function gpuCopies(resource: { _gpuData: Record<number, unknown> }): number {
  let n = 0;
  for (const uid in resource._gpuData) {
    if (resource._gpuData[uid]) n++;
  }
  return n;
}

function backdate(...resources: GcClocked[]): void {
  for (const resource of resources) resource._gcLastUsed = performance.now() - 100_000;
}

function collectStale(renderer: Renderer, ...stale: GcClocked[]): void {
  const saved = renderer.gc.maxUnusedTime;
  renderer.gc.maxUnusedTime = 1000;
  backdate(...stale);
  renderer.gc.run();
  renderer.gc.maxUnusedTime = saved;
}

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

    it('survives a drawn material texture being unloaded and re-uploads it', async () => {
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

    it('re-keys the group of every material in a run when the texture they share is resized', async () => {
      const app = await getApp<Renderer>({
        id: `capture-texture-rekey-run-${preference}`,
        appOptions: { preference, width: 128, height: 128, backgroundColor: 0x000000 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);

        lightAndFrame(view3d);
        const texture = makeCollectableTexture('#ff8800');
        const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
        for (let i = 0; i < 2; i++) {
          const mesh = new Mesh3D({
            geometry,
            material: new Material3D({ baseColorTexture: texture, metallic: 0, roughness: 0.25 + i * 0.5 }),
          });
          mesh.position.set(i * 1.5 - 0.75, 0, 0);
          view3d.root.addChild(mesh);
        }

        app.render();
        const list = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE].commandList;
        const keysOf = () =>
          list.commands
            .slice(0, list.count)
            .map((cmd) => `${cmd.batchBindGroup!._keyLow}:${cmd.batchBindGroup!._keyHigh}`);
        const keys = keysOf();
        expect(keys.length, 'WebGPU draws the run direct, a command per material; WebGL merges it').toBe(
          preference === 'webgpu' ? 2 : 1,
        );

        texture.source.resize(8, 8);
        await expectCleanRender(app);
        const resized = keysOf();
        for (let i = 0; i < keys.length; i++) {
          expect(resized[i], `command ${i}'s group, though only the run's first material is captured`).not.toBe(
            keys[i],
          );
        }
      } finally {
        app.destroy();
      }
    });

    it('draws a swapped texture on the next frame, through the rebuild the swap causes', async () => {
      const app = await getApp<Renderer>({
        id: `capture-texture-swap-${preference}`,
        appOptions: { preference, width: 128, height: 128, backgroundColor: 0x000000 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);

        lightAndFrame(view3d);
        const orange = makeCollectableTexture('#ff8800');
        const blue = makeCollectableTexture('#0044ff');
        const material = new Material3D({ baseColorTexture: orange, metallic: 0, roughness: 0.5 });
        view3d.root.addChild(new Mesh3D({ geometry: new CubeGeometry({ width: 2, height: 2, depth: 2 }), material }));

        app.render();
        const before = readPixels(app, view3d);
        const pd = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
        const dirtyId = pd.commandList.dirtyId;

        material.textures.baseColor = blue;
        await expectCleanRender(app);
        expect(pd.commandList.dirtyId, 'the swap rebuilt the list').toBeGreaterThan(dirtyId);
        expect(pd.commandList.commands[0].batchBindGroup!.getResource(0)).toBe(blue.source);
        expect(readPixels(app, view3d)).not.toEqual(before);

        material.textures.baseColor = orange;
        await expectCleanRender(app);
        expect(readPixels(app, view3d)).toEqual(before);
      } finally {
        app.destroy();
      }
    });

    it('rebinds a fresh material bind group after material.unload() on an untextured material', async () => {
      const app = await getApp<Renderer>({
        id: `capture-material-unload-${preference}`,
        appOptions: { preference, width: 128, height: 128, backgroundColor: 0x000000 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);

        lightAndFrame(view3d);
        const material = new Material3D({ baseColor: 0xff8800, metallic: 0, roughness: 0.5 });
        const mesh = new Mesh3D({ geometry: new CubeGeometry({ width: 2, height: 2, depth: 2 }), material });
        view3d.root.addChild(mesh);

        app.render();
        const before = readPixels(app, view3d);
        expect(before.some((channel) => channel > 0)).toBe(true);
        const pd = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
        const drawDirtyId = pd.drawDirtyId;
        const group = pd.commandList.commands[0].batchBindGroup!;
        const materialGroup = () =>
          preference === 'webgl' ? material._getMergedBindGroup() : material._getBindGroup();
        expect(group).toBe(materialGroup());

        material.unload();
        expect(group.resources, 'unload dropped the bound group whole').not.toBeNull();
        expect(materialGroup(), 'the material builds a new one').not.toBe(group);

        await expectCleanRender(app);
        expect(pd.drawDirtyId, 'the meshes rebuilt their commands').toBeGreaterThan(drawDirtyId);
        const rebound = pd.commandList.commands[0].batchBindGroup!;
        expect(rebound).not.toBe(group);
        expect(rebound.resources, 'the draw binds a live group').not.toBeNull();
        expect(rebound).toBe(materialGroup());
        expect(readPixels(app, view3d)).toEqual(before);
      } finally {
        app.destroy();
      }
    });

    it('rebinds a fresh merged bind group after the bound material’s unload()', async () => {
      const app = await getApp<Renderer>({
        id: `capture-merged-material-unload-${preference}`,
        appOptions: { preference, width: 128, height: 128, backgroundColor: 0x000000 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);

        lightAndFrame(view3d);
        const geometry = new CubeGeometry({ width: 0.5, height: 0.5, depth: 0.5 });
        const meshes = Array.from({ length: MERGE_THRESHOLD + 1 }, (_, i) => {
          const mesh = new Mesh3D({
            geometry,
            material: new Material3D({ baseColor: 0xff8800, metallic: 0, roughness: i / MERGE_THRESHOLD }),
          });
          mesh.position.set(i - 3, 0, 0);
          return mesh;
        });
        view3d.root.addChild(...meshes);

        app.render();
        const before = readPixels(app, view3d);
        expect(before.some((channel) => channel > 0)).toBe(true);
        const pd = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
        expect(pd.commandList.count, 'more materials than the threshold on one geometry: one merged draw').toBe(1);
        const drawDirtyId = pd.drawDirtyId;
        const group = pd.commandList.commands[0].batchBindGroup!;
        const bound = meshes.find((mesh) => mesh.material._getMergedBindGroup() === group);
        expect(bound, 'the draw binds one of the run’s merged groups').toBeDefined();

        bound!.material.unload();
        expect(group.resources, 'unload dropped the bound merged group whole').not.toBeNull();

        await expectCleanRender(app);
        expect(pd.drawDirtyId, 'the meshes rebuilt their commands').toBeGreaterThan(drawDirtyId);
        expect(pd.commandList.count).toBe(1);
        const rebound = pd.commandList.commands[0].batchBindGroup!;
        expect(rebound).not.toBe(group);
        expect(rebound.resources, 'the draw binds a live group').not.toBeNull();
        expect(rebound, 'the same material starts the run and rebuilt its group').toBe(
          bound!.material._getMergedBindGroup(),
        );
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
        grown.set(positions.data);
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
        batched.setPassesAt(0, RenderPassBit.OPAQUE);
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

    it('leaves nothing bound to a removed merged run’s texture once its materials are destroyed', async () => {
      const app = await getApp<Renderer>({
        id: `capture-bind-group-trim-merged-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);
        lightAndFrame(view3d);

        const geometry = new CubeGeometry({ width: 0.5, height: 0.5, depth: 0.5 });
        const texture = makeCollectableTexture('#ff8800');
        const meshes = Array.from({ length: MERGE_THRESHOLD + 1 }, (_, i) => {
          const mesh = new Mesh3D({
            geometry,
            material: new Material3D({ baseColorTexture: texture, roughness: i / MERGE_THRESHOLD }),
          });
          mesh.position.set(i - 3, 0, 0);
          return mesh;
        });
        const keeper = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0xffffff }) });
        keeper.position.set(0, -2, 0);
        view3d.root.addChild(keeper, ...meshes);
        app.render();

        const list = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE].commandList;
        expect(list.count, 'the keeper draws direct, the textured run merges').toBe(2);
        const commands = list.commands.slice(0, list.count);
        expect(commands.some((cmd) => cmd.batchBindGroup === meshes[0].material._getMergedBindGroup())).toBe(true);
        expect(captures(list).has(texture.source), 'the list captures what the merged draw binds').toBe(true);
        view3d.root.removeChild(...meshes);
        app.render();

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          for (const mesh of meshes) mesh.material.destroy();
          texture.destroy(true);
          expect(
            warn.mock.calls.filter((call) => String(call[1]).includes('BindGroup')),
            'every group that held the source, the first material’s merged group and the direct groups built before the rewind, holds it unwatched',
          ).toEqual([]);
        } finally {
          warn.mockRestore();
        }

        await expectCleanRender(app);
        expect(
          captures(list).has(texture.source),
          'once the texture goes, the list rebuilds without it, dead command included',
        ).toBe(false);
      } finally {
        app.destroy();
      }
    });

    it('leaves nothing bound to a removed model’s textures once its materials are destroyed', async () => {
      const app = await getApp<Renderer>({
        id: `capture-bind-group-trim-direct-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);
        lightAndFrame(view3d);

        const geometry = new CubeGeometry({ width: 0.5, height: 0.5, depth: 0.5 });
        const textures = Array.from({ length: 4 }, (_, i) => makeCollectableTexture(`hsl(${i * 60}, 80%, 50%)`));
        const meshes = textures.map((texture, i) => {
          const mesh = new Mesh3D({ geometry, material: new Material3D({ baseColorTexture: texture }) });
          mesh.position.set(i - 2, 0, 0);
          return mesh;
        });
        const keeper = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0xffffff }) });
        keeper.position.set(0, -2, 0);
        view3d.root.addChild(keeper, ...meshes);
        app.render();

        const list = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE].commandList;
        const groups = new Set(list.commands.slice(0, list.count).map((cmd) => cmd.batchBindGroup));
        expect(groups.size, 'one draw per material, each binding its own group').toBe(meshes.length + 1);
        for (const texture of textures) expect(captures(list).has(texture.source)).toBe(true);

        view3d.root.removeChild(...meshes);
        app.render();
        for (const texture of textures) expect(captures(list).has(texture.source), 'the rebuild swept it').toBe(false);

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          for (const mesh of meshes) mesh.material.destroy();
          for (const texture of textures) texture.destroy(true);
          expect(
            warn.mock.calls.filter((call) => String(call[1]).includes('BindGroup')),
            'the material’s own group is the only one that held the source, and it went with the material',
          ).toEqual([]);
        } finally {
          warn.mockRestore();
        }
      } finally {
        app.destroy();
      }
    });

    it('a transparent pass whose order flips every frame rebuilds each time and adds no listeners or captures', async () => {
      const app = await getApp<Renderer>({
        id: `capture-always-rebuild-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);
        lightAndFrame(view3d);

        const texture = makeCollectableTexture('#ff8800');
        const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
        const material = new Material3D({ baseColorTexture: texture, alphaMode: 'blend' });
        for (const z of [1.5, -1.5]) {
          const mesh = new Mesh3D({ geometry, material });
          mesh.position.z = z;
          view3d.root.addChild(mesh);
        }

        app.render();
        const pd = view3d._sceneBatch.drawLists[RenderPassBit.TRANSPARENT];
        expect(pd.commandList.count).toBeGreaterThan(0);
        expect(captures(pd.commandList).has(texture.source)).toBe(true);
        const captureCount = captures(pd.commandList).size;
        const listeners = texture.source.listenerCount('change');
        const built = pd.commandList.dirtyId;

        for (let i = 0; i < 5; i++) {
          view3d.camera.position.set(3, 4, i % 2 === 0 ? -7 : 7);
          view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
          app.render();
        }

        expect(pd.commandList.dirtyId, 'the camera swapped sides every frame, so every frame rebuilt').toBe(built + 5);
        expect(texture.source.listenerCount('change')).toBe(listeners);
        expect(captures(pd.commandList).size).toBe(captureCount);
      } finally {
        app.destroy();
      }
    });

    it('draws with a texture’s new sampler after style.update(), in the bundled opaque pass', async () => {
      const app = await getApp<Renderer>({
        id: `capture-style-change-${preference}`,
        appOptions: { preference, width: 64, height: 64, backgroundColor: 0x000000 },
      });

      try {
        const view3d = new View3D({ width: 64, height: 64 });
        app.stage.addChild(view3d);
        lightAndFrame(view3d);

        const texture = makeCheckerTexture();

        const mesh = new Mesh3D({
          geometry: new CubeGeometry({ width: 2, height: 2, depth: 2 }),
          material: new FlatMaterial({ baseColorTexture: texture }),
        });
        view3d.root.addChild(mesh);

        app.render();
        const before = readPixels(app, view3d);

        texture.source.style.scaleMode = 'nearest';
        texture.source.style.update();
        await expectCleanRender(app);
        const afterUpdate = readPixels(app, view3d);

        mesh.invalidate();
        await expectCleanRender(app);
        const afterRebuild = readPixels(app, view3d);

        expect(afterRebuild, 'the sampler change shows at all').not.toEqual(before);
        expect(afterUpdate, 'the bundled pass picks up the new sampler without a rebuild').toEqual(afterRebuild);

        mesh.removeFromParent();
        mesh.material.destroy();
        texture.destroy(true);
      } finally {
        app.destroy();
      }
    });

    for (const replace of [false, true]) {
      it(`draws the style a texture got back while out of the view, through ${replace ? 'source.style' : 'style.update()'}`, async () => {
        const app = await getApp<Renderer>({
          id: `capture-style-restore-${replace ? 'replace' : 'update'}-${preference}`,
          appOptions: { preference, width: 64, height: 64, backgroundColor: 0x000000 },
        });

        try {
          const view3d = new View3D({ width: 64, height: 64 });
          app.stage.addChild(view3d);
          lightAndFrame(view3d);

          const texture = makeCheckerTexture();
          const source = texture.source;
          const original = source.style;
          const scaleMode = original.scaleMode;
          const nearest = new TextureStyle({ scaleMode: 'nearest' });
          const setNearest = (on: boolean): void => {
            if (replace) {
              source.style = on ? nearest : original;
              return;
            }
            source.style.scaleMode = on ? 'nearest' : scaleMode;
            source.style.update();
          };

          const geometry = new CubeGeometry({ width: 2, height: 2, depth: 2 });
          const mesh = new Mesh3D({ geometry, material: new FlatMaterial({ baseColorTexture: texture }) });
          const keeper = new Mesh3D({ geometry, material: new FlatMaterial({ baseColor: 0xffffff }) });
          keeper.position.set(0, -3, 0);
          view3d.root.addChild(mesh, keeper);

          await expectCleanRender(app);
          const before = readPixels(app, view3d);

          setNearest(true);
          await expectCleanRender(app);
          expect(readPixels(app, view3d), 'the sampler change shows at all').not.toEqual(before);

          mesh.removeFromParent();
          await expectCleanRender(app);
          setNearest(false);
          view3d.root.addChild(mesh);
          await expectCleanRender(app);
          expect(readPixels(app, view3d), 'drawn again, it samples with the restored style').toEqual(before);

          mesh.removeFromParent();
          mesh.material.destroy();
          texture.destroy(true);
        } finally {
          app.destroy();
        }
      });
    }
  });
}
