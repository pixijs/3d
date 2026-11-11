import { expectCleanRender, getApp } from '@test-utils';
import { CanvasSource, Texture } from 'pixi.js';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { MERGE_THRESHOLD } from '~/core/batcher/batchConstants';
import type { DrawCommandList } from '~/core/batcher/DrawCommandList';
import type { Mesh3DBatch } from '~/core/batcher/Mesh3DBatch';
import { getCameraData } from '~/core/CameraData';
import type { CullResult } from '~/core/render-passes/CullResult';
import type { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { Skeleton } from '~/scene/Skeleton';
import { View3D } from '~/scene/View3D';
import type { View3DGlobalData } from '~/scene/View3DGlobalData';

const SIZE = 128;

interface GpuResident {
  _gpuData: Record<string, unknown>;
}

function gpuCopyCount(...resources: (GpuResident | null | undefined)[]): number {
  let n = 0;
  for (const resource of resources) {
    if (resource) n += Object.keys(resource._gpuData).length;
  }
  return n;
}

function storeResidency(view3d: View3D, batches: Mesh3DBatch[]): number {
  const stores = [view3d._bonePit, ...batches.map((batch) => batch.storeBuffer)];

  return gpuCopyCount(
    ...stores.flatMap((store) => {
      const { _buffer, _textureSource } = store as unknown as {
        _buffer?: GpuResident | null;
        _textureSource?: GpuResident | null;
      };

      return [_buffer, _textureSource];
    }),
  );
}

function resultResidency(result: CullResult | undefined): number {
  if (!result) return 0;
  return gpuCopyCount(result.survivors.buffer, result.indirectDrawData.drawCallsBuffer);
}

function captures(list: DrawCommandList): Map<unknown, unknown> {
  return (list as unknown as { _captures: Map<unknown, unknown> })._captures;
}

function globalData(view3d: View3D, uid: number): View3DGlobalData {
  const data: View3DGlobalData | null = view3d._gpuData[uid] ?? null;
  expect(data).not.toBeNull();
  return data;
}

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

function skinnedMesh(jointCount = 1): Mesh3D {
  const geometry = new Geometry3D({
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    joints: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    weights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  });

  const inverseBindMatrices = new Float32Array(jointCount * 16);
  for (let i = 0; i < jointCount; i++) {
    inverseBindMatrices.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], i * 16);
  }

  const mesh = new Mesh3D({
    geometry,
    material: new Material3D({ baseColor: 0x4488ff }),
    skeleton: new Skeleton({
      parent: new Int16Array(jointCount).fill(-1),
      joints: new Int16Array(jointCount).map((_, i) => i),
      inverseBindMatrices,
    }),
  });
  mesh.position.set(-3, 1, 0);

  return mesh;
}

interface ShadowPassProbe {
  _renderTarget: unknown;
}

function growStores(view3d: View3D): void {
  const geometry = new CubeGeometry({ width: 0.2, height: 0.2, depth: 0.2 });
  const material = new Material3D({ baseColor: 0x333333 });
  for (let i = 0; i < 120; i++) {
    const mesh = new Mesh3D({ geometry, material });
    mesh.position.set(-8 + (i % 12) * 0.3, 4, -4);
    view3d.root.addChild(mesh);
  }

  view3d.root.addChild(skinnedMesh(300));
}

interface Scene {
  view3d: View3D;
  texture: Texture;
  dynamicGeometry: Geometry3D;
  batched: BatchedMesh3D;
  sun: DirectionalLight;
  textured: Mesh3D;
}

function buildScene(app: Application<Renderer>): Scene {
  const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'low' });
  app.stage.addChild(view3d);

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 20, height: 20 }),
    material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
    castShadow: false,
  });
  ground.position.set(0, -1.5, 0);
  ground.rotation.set(-Math.PI / 2, 0, 0);
  view3d.root.addChild(ground);

  const texture = makeCollectableTexture('#ff8800');
  const textured = new Mesh3D({
    geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 }),
    material: new Material3D({ baseColorTexture: texture, metallic: 0, roughness: 0.5 }),
    castShadow: true,
  });
  view3d.root.addChild(textured);

  const dynamicGeometry = new CubeGeometry({ width: 1, height: 1, depth: 1, dynamic: true });
  const dynamic = new Mesh3D({
    geometry: dynamicGeometry,
    material: new Material3D({ baseColor: 0x22cc55, metallic: 0, roughness: 0.5 }),
    castShadow: true,
  });
  dynamic.position.set(2.5, 0, 0);
  view3d.root.addChild(dynamic);

  view3d.root.addChild(skinnedMesh());

  const batched = new BatchedMesh3D({ size: 1 });
  batched.setGeometryAt(0, new CubeGeometry({ width: 1, height: 1, depth: 1 }));
  batched.setMaterialAt(0, new Material3D({ baseColor: 0xdd4444, metallic: 0, roughness: 0.5 }));
  batched.setMatrixAt(0, new Matrix4());
  batched.setPassesAt(0, RenderPassBit.OPAQUE);
  batched.position.set(0, 1.8, 2);
  view3d.root.addChild(batched);

  const sun = new DirectionalLight({ color: 0xfff4e0, intensity: 4, castShadow: true });
  sun.rotation.set((-55 * Math.PI) / 180, (55 * Math.PI) / 180, 0);
  view3d.root.addChild(sun);

  view3d.camera.position.set(4, 5, 9);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  app.render();

  return { view3d, texture, dynamicGeometry, batched, sun, textured };
}

function pixels(app: Application<Renderer>, view3d: View3D): Uint8Array {
  return new Uint8Array(app.renderer.extract.pixels(view3d).pixels);
}

function differingPixels(a: Uint8Array, b: Uint8Array, tol = 8): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > tol || Math.abs(a[i + 1] - b[i + 1]) > tol || Math.abs(a[i + 2] - b[i + 2]) > tol) {
      n++;
    }
  }
  return n;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`view unload (${preference})`, () => {
    async function withApp(id: string, run: (app: Application<Renderer>) => Promise<void> | void): Promise<void> {
      const app = await getApp<Renderer>({
        id: `${id}-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x101018 },
      });
      try {
        await run(app);
      } finally {
        app.destroy();
      }
    }

    function expectDestroyed(data: View3DGlobalData): void {
      expect(data.globalBindGroup.resources).toBeNull();
      const buffer = data.globalUniformGroup.buffer;
      expect(buffer?.destroyed).toBe(true);
    }

    it('frees the GPU copies of the stores the view owns', async () => {
      await withApp('view-unload-buffers', (app) => {
        const { view3d, batched } = buildScene(app);
        const batches = [view3d._sceneBatch, batched.batch];

        expect(storeResidency(view3d, batches)).toBeGreaterThan(0);

        view3d.unload();

        expect(storeResidency(view3d, batches)).toBe(0);
      });
    });

    it('drops the captures its builds took, with the textures bound through the materials’ groups', async () => {
      await withApp('view-unload-captures', (app) => {
        const { view3d, texture, textured, dynamicGeometry, batched } = buildScene(app);
        const opaque = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE].commandList;
        const shadow = view3d._sceneBatch.drawLists[RenderPassBit.SHADOW].commandList;
        const batchedOpaque = batched.batch.drawLists[RenderPassBit.OPAQUE].commandList;
        const buffers = dynamicGeometry.buffers;

        expect(captures(opaque).has(texture.source), 'the list captures what the material binds').toBe(true);
        const materialGroup =
          preference === 'webgl' ? textured.material._getMergedBindGroup() : textured.material._getBindGroup();
        const commands = opaque.commands.slice(0, opaque.count);
        expect(commands.some((cmd) => cmd.batchBindGroup === materialGroup)).toBe(true);
        expect(buffers.map((b) => captures(opaque).has(b))).toEqual(buffers.map(() => true));
        expect(buffers.map((b) => captures(shadow).has(b))).toEqual(buffers.map(() => true));

        view3d.unload();

        for (const list of [opaque, shadow, batchedOpaque]) expect(captures(list).size).toBe(0);
        buffers.forEach((b) => b.unload());
        texture.source.unload();
        expect(opaque.count).toBe(0);
      });
    });

    it('drops a merged run’s captures and commands, and draws the run merged again afterwards', async () => {
      await withApp('view-unload-merged', async (app) => {
        const { view3d, sun } = buildScene(app);
        const geometry = new CubeGeometry({ width: 0.4, height: 0.4, depth: 0.4 });
        const texture = makeCollectableTexture('#3388ff');
        const meshes = Array.from({ length: MERGE_THRESHOLD + 1 }, (_, i) => {
          const mesh = new Mesh3D({
            geometry,
            material: new Material3D({ baseColorTexture: texture, metallic: 0, roughness: i / MERGE_THRESHOLD }),
          });
          mesh.position.set(i - 3, 3, 0);
          view3d.root.addChild(mesh);
          return mesh;
        });
        app.render();
        const bit = RenderPassBit.OPAQUE;
        const opaque = view3d._sceneBatch.drawLists[bit].commandList;
        expect(opaque.count, 'added after the first build, the run draws from tail commands').toBeGreaterThan(
          opaque.bodyCount,
        );
        view3d._sceneBatch.invalidateDrawCaches();
        sun.refreshShadows();
        app.render();
        expect(opaque.count, 'until a rebuild, as a scene built before its first frame gets').toBe(opaque.bodyCount);

        const commands = opaque.commands.slice(0, opaque.count);
        const bound = meshes.find((mesh) =>
          commands.some((cmd) => cmd.batchBindGroup === mesh.material._getMergedBindGroup()),
        );
        expect(bound, 'the run draws merged, bound to one of its materials’ merged groups').toBeDefined();
        const mergedShader =
          preference === 'webgl' ? bound!._passCache[bit].shader : bound!._passCache[bit].mergedShader;
        expect(mergedShader).not.toBeNull();
        expect(commands.some((cmd) => cmd.shader === mergedShader)).toBe(true);
        expect(captures(opaque).has(texture.source), 'the list captures what the merged draw binds').toBe(true);
        const before = pixels(app, view3d);

        view3d.unload();

        expect(captures(opaque).size).toBe(0);
        expect(opaque.count).toBe(0);
        texture.source.unload();

        await expectCleanRender(app);
        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
        const rebuilt = opaque.commands.slice(0, opaque.count);
        const group = bound!.material._getMergedBindGroup();
        expect(group.resources, 'the merged group is the material’s, and it is still live').not.toBeNull();
        expect(
          rebuilt.some((cmd) => cmd.batchBindGroup === group),
          'the run draws merged again',
        ).toBe(true);
        expect(
          rebuilt.some(
            (cmd) =>
              cmd.shader ===
              (preference === 'webgl' ? bound!._passCache[bit].shader : bound!._passCache[bit].mergedShader),
          ),
          'the merged shader comes back from the renderer’s cache',
        ).toBe(true);
        expect(captures(opaque).has(texture.source)).toBe(true);
      });
    });

    it('drops the draw programs, shadow map, global data and cull result buffers', async () => {
      await withApp('view-unload-structural', (app) => {
        const { view3d } = buildScene(app);
        const uid = app.renderer.uid;

        const pass = view3d.passByBit[RenderPassBit.SHADOW] as unknown as ShadowPassProbe;
        const opaque = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
        expect(pass._renderTarget).not.toBeNull();
        expect(opaque.commandList.count).toBeGreaterThan(0);
        const data = globalData(view3d, uid);
        const forward = view3d.passByBit[RenderPassBit.OPAQUE] as ForwardRenderPass;
        const result = forward.cullResults.get(view3d._sceneBatch);
        expect(result !== undefined).toBe(preference === 'webgpu');
        expect(resultResidency(result)).toBe(result ? 2 : 0);

        view3d.unload();

        expect(pass._renderTarget).toBeNull();
        expect(opaque.commandList.count).toBe(0);
        expect(opaque.isDrawStale()).toBe(true);
        expect(result?.bundle ?? null).toBeNull();
        expect(result?.isBundleStale(opaque, getCameraData(view3d.camera).bindGroup) ?? true).toBe(true);
        expect(resultResidency(result)).toBe(0);
        expectDestroyed(data);
        expect(view3d._gpuData[uid] ?? null).toBe(null);

        app.render();
        const reminted = globalData(view3d, uid);
        expect(reminted, 'the next render makes new global data').not.toBe(data);
        expect(view3d._gpuData[uid]).toBe(reminted);
        expect(reminted.globalUniformGroup.buffer?.destroyed ?? false).toBe(false);

        const revivedPass = view3d.passByBit[RenderPassBit.OPAQUE] as ForwardRenderPass;
        const revived = revivedPass.cullResults.get(view3d._sceneBatch);
        expect(revived === undefined).toBe(preference !== 'webgpu');
        expect(resultResidency(revived)).toBe(revived ? 2 : 0);
      });
    });

    it('frees the buffers and textures growth retired', async () => {
      await withApp('view-unload-retired', (app) => {
        const { view3d } = buildScene(app);

        const bonePit = view3d._bonePit as unknown as { _retiredBuffers: unknown[] };
        const store = view3d._sceneBatch.storeBuffer as unknown as {
          _retiredBuffers: unknown[];
          _retiredTextures: unknown[];
        };
        growStores(view3d);
        app.render();
        const retired = bonePit._retiredBuffers.length + store._retiredBuffers.length + store._retiredTextures.length;
        expect(retired).toBeGreaterThan(0);

        view3d.unload();

        expect(bonePit._retiredBuffers.length).toBe(0);
        expect(store._retiredBuffers.length).toBe(0);
        expect(store._retiredTextures.length).toBe(0);
      });
    });

    it('is idempotent', async () => {
      await withApp('view-unload-idempotent', async (app) => {
        const { view3d, sun } = buildScene(app);

        sun.refreshShadows();
        app.render();
        const before = pixels(app, view3d);

        view3d.unload();
        expect(() => view3d.unload()).not.toThrow();

        await expectCleanRender(app);
        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
      });
    });

    it('re-renders a manual-cadence light’s shadows after an unload', async () => {
      await withApp('view-unload-manual-shadow', (app) => {
        const { view3d, sun } = buildScene(app);

        sun.shadow.update = 'manual';
        sun.refreshShadows();
        app.render();
        app.render();
        const before = pixels(app, view3d);

        view3d.unload();
        app.render();

        expect(
          differingPixels(before, pixels(app, view3d)),
          'the unload requests the shadow refresh a manual cadence would skip',
        ).toBe(0);
      });
    });

    it('keeps tracking scene changes after an unload', async () => {
      await withApp('view-unload-continued-life', async (app) => {
        const { view3d, textured, sun } = buildScene(app);

        sun.refreshShadows();
        app.render();
        const before = pixels(app, view3d);

        view3d.unload();
        app.render();

        textured.position.y += 1.5;
        await expectCleanRender(app);
        expect(differingPixels(before, pixels(app, view3d))).toBeGreaterThan(0);
      });
    });

    it('emits one `unload` event, which unloads the global data and frees its GC listener', async () => {
      await withApp('view-unload-event', (app) => {
        const { view3d } = buildScene(app);
        const uid = app.renderer.uid;
        const data = globalData(view3d, uid);
        expect(view3d.listenerCount('unload')).toBe(1);

        let unloadEvents = 0;
        const countUnloads = (): number => unloadEvents++;
        view3d.on('unload', countUnloads);
        view3d.unload();
        view3d.off('unload', countUnloads);

        expect(unloadEvents).toBe(1);
        expectDestroyed(data);
        expect(view3d._gpuData[uid] ?? null).toBe(null);
        expect(view3d.listenerCount('unload')).toBe(0);

        app.render();
        expect(globalData(view3d, uid), 'the next render makes new global data').not.toBe(data);
        expect(view3d._gpuData[uid] ?? null, 'the GC slot is filled again').not.toBe(null);
        expect(view3d.listenerCount('unload'), 'the next render re-enrols the view').toBe(1);
      });
    });

    it('is a no-op before the first render and after destroy', async () => {
      await withApp('view-unload-lifecycle', (app) => {
        const fresh = new View3D({ width: SIZE, height: SIZE });
        expect(() => fresh.unload()).not.toThrow();
        fresh.destroy();
        expect(() => fresh.unload()).not.toThrow();

        const { view3d } = buildScene(app);
        view3d.destroy();
        expect(() => view3d.unload()).not.toThrow();
      });
    });
  });
}
