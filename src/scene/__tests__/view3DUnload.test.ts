import { getApp } from '@test-utils';
import { CanvasSource, Texture } from 'pixi.js';
import type { Application, BindGroup, Renderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { MAX_BATCH_TEXTURES } from '~/core/batcher/batchConstants';
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

/** pixi keeps one GPU copy per renderer of a buffer or texture source, keyed by renderer uid. */
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

/**
 * Everything a view's mesh stores and bone pit keep on the GPU. Both hold a buffer (bound
 * directly on WebGPU) and a lazily-created data texture (how WebGL reads them), so a
 * backend-agnostic assertion has to count them together.
 */
function storeResidency(view3d: View3D, batches: Mesh3DBatch[]): number {
  const stores = [view3d._bonePit, ...batches.map((batch) => batch.storeBuffer)];
  return gpuCopyCount(
    ...stores.map((store) => store.buffer as unknown as GpuResident),
    ...stores.map((store) => (store as unknown as { _textureSource?: GpuResident })._textureSource),
  );
}

/**
 * The GPU copies one cull result holds: its survivor records and its indirect draw args. Both are
 * `Buffer3D`s, exempt from pixi's GC, so nothing but an explicit unload ever frees them.
 */
function resultResidency(result: CullResult | undefined): number {
  if (!result) return 0;
  return gpuCopyCount(
    result.survivors.buffer as unknown as GpuResident,
    result.indirectDrawData.drawCallsBuffer as unknown as GpuResident,
  );
}

/** The resources a pass's recorded build bakes — the list's capture map, by membership and size. */
function captures(list: DrawCommandList): Map<unknown, unknown> {
  return (list as unknown as { _captures: Map<unknown, unknown> })._captures;
}

/** The renderer's global data on the View, minted by the first `execute` that drew it. */
function globalData(view3d: View3D, uid: number): View3DGlobalData {
  const data: View3DGlobalData | null = view3d._gpuData[uid] ?? null;
  expect(data).not.toBeNull();
  return data!;
}

/** The distinct real sources the list's pooled texture bind groups still hold. */
function boundSources(list: DrawCommandList): Set<unknown> {
  const groups = (list as unknown as { _bindGroups: BindGroup[] })._bindGroups;
  const bound = new Set<unknown>();
  for (const bg of groups) {
    for (let s = 0; s < MAX_BATCH_TEXTURES; s++) {
      const resource = bg.getResource(s);
      if (resource !== Texture.EMPTY.source) bound.add(resource);
    }
  }
  return bound;
}

/** A collectable texture — pixi only auto-collects sources that opt in. */
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

/** A skinned quad with `jointCount` joints, so the scene fills the bone pit and its WebGL data texture. */
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

/** The one shadow-pass internal these tests assert against. */
interface ShadowPassProbe {
  _renderTarget: unknown;
}

/**
 * Push the mesh store past its 100-slot capacity and the bone pit past its 256-bone one, so
 * both have a buffer retired by growth for the unload to free.
 */
function growStores(view3d: View3D): void {
  const geometry = new CubeGeometry({ width: 0.2, height: 0.2, depth: 0.2 });
  const material = new Material3D({ baseColor: 0x333333 });
  for (let i = 0; i < 120; i++) {
    const mesh = new Mesh3D({ geometry, material });
    mesh.position.set(-8 + (i % 12) * 0.3, 4, -4);
    view3d.root.addChild(mesh);
  }

  // Past the pit's 256-matrix starting capacity in one mesh.
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

/**
 * A view holding one of everything the unload has to give back: a captured batch texture,
 * a self-owned (non-atlased) geometry, bone-pit content, a user batch, and a shadow caster.
 */
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
  batched.setItemActive(0, RenderPassBit.OPAQUE);
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

/** Renders one frame, returning the WebGPU validation error it raised (always `null` on WebGL). */
async function renderCatchingValidationErrors(app: Application<Renderer>): Promise<GPUError | null> {
  const device = 'gpu' in app.renderer ? (app.renderer as WebGPURenderer).gpu.device : null;
  if (!device) {
    app.render();
    return null;
  }

  device.pushErrorScope('validation');
  app.render();
  return device.popErrorScope();
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

    /**
     * pixi's hash ran the payload: the bind group's slots are gone, then the uniform buffer it
     * bound. Only WebGPU realises that buffer (the WebGL group syncs through `uniform*` calls and
     * never owns one), so on WebGL there is no buffer to free.
     */
    function expectDestroyed(data: View3DGlobalData): void {
      expect(data.globalBindGroup.resources).toBeNull();
      const buffer = data.globalUniformGroup.buffer;
      expect(buffer ? buffer.destroyed : preference === 'webgl').toBe(true);
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

    it('renders the same frame again after an unload', async () => {
      await withApp('view-unload-revive', async (app) => {
        const { view3d, sun } = buildScene(app);

        // Frame 1 of a shadow membership rebuild is documented-wrong, so settle the
        // shadows before the baseline is taken.
        sun.refreshShadows();
        app.render();
        const before = pixels(app, view3d);
        expect(before.some((channel) => channel > 0)).toBe(true);

        view3d.unload();

        const error = await renderCatchingValidationErrors(app);
        expect(error).toBe(null);
        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
      });
    });

    it('drops the captures its builds took and lets go of their textures', async () => {
      await withApp('view-unload-captures', (app) => {
        const { view3d, texture, dynamicGeometry, batched } = buildScene(app);
        app.render();
        const opaque = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE].commandList;
        const shadow = view3d._sceneBatch.drawLists[RenderPassBit.SHADOW].commandList;
        const batchedOpaque = batched.batch.drawLists[RenderPassBit.OPAQUE].commandList;
        const buffers = dynamicGeometry.buffers;

        expect(captures(opaque).has(texture.source)).toBe(true);
        expect(boundSources(opaque).has(texture.source)).toBe(true);
        expect(buffers.map((b) => captures(opaque).has(b))).toEqual(buffers.map(() => true));
        expect(buffers.map((b) => captures(shadow).has(b))).toEqual(buffers.map(() => true));

        view3d.unload();

        // Nothing of the builds remains: no capture listens, and no pooled bind group still
        // holds a source that pixi could later be told was destroyed while bound.
        for (const list of [opaque, shadow, batchedOpaque]) {
          expect(captures(list).size).toBe(0);
          expect(boundSources(list).size).toBe(0);
        }
        buffers.forEach((b) => b.unload());
        texture.source.unload();
        expect(opaque.count).toBe(0);
      });
    });

    it('drops the recorded draw programs, the shadow map, and the global bind groups', async () => {
      await withApp('view-unload-structural', (app) => {
        const { view3d } = buildScene(app);
        const uid = app.renderer.uid;

        const pass = view3d.passByBit[RenderPassBit.SHADOW] as unknown as ShadowPassProbe;
        const opaque = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
        expect(pass._renderTarget).not.toBeNull();
        expect(opaque.commandList.count).toBeGreaterThan(0);
        const data = globalData(view3d, uid);
        // WebGPU culls the batch into a cull result that owns the bundle and the two buffers it was
        // recorded against; WebGL mints no result at all. Both buffers are resident here, so the
        // zero after the unload means something.
        const forward = view3d.passByBit[RenderPassBit.OPAQUE] as ForwardRenderPass;
        const result = forward.cullResults.get(view3d._sceneBatch);
        expect(result !== undefined).toBe(preference === 'webgpu');
        expect(resultResidency(result)).toBe(result ? 2 : 0);

        view3d.unload();

        expect(pass._renderTarget).toBeNull();
        expect(opaque.commandList.count).toBe(0);
        // A cleared list with an unchanged renderable count would otherwise replay as-is.
        expect(opaque.isDrawStale(opaque.view.count)).toBe(true);
        expect(result?.bundle ?? null).toBeNull();
        expect(result?.isBundleStale(opaque, getCameraData(view3d.camera).bindGroup) ?? true).toBe(true);
        expect(resultResidency(result)).toBe(0);
        // The `unload` event ran this renderer's global data and cleared its slot.
        expectDestroyed(data);
        expect(view3d._gpuData[uid] ?? null).toBe(null);

        // The next render mints a new payload over live resources rather than reviving this one.
        app.render();
        const reminted = globalData(view3d, uid);
        expect(reminted).not.toBe(data);
        expect(reminted.globalBindGroup.resources).not.toBeNull();
        expect(reminted.globalUniformGroup.buffer?.destroyed ?? false).toBe(false);

        // The unload freed the result's GPU memory without ending the result: the pass kept it and
        // this frame re-synced and re-filled the same two buffers.
        const revived = forward.cullResults.get(view3d._sceneBatch);
        expect(revived).toBe(result);
        expect(resultResidency(revived)).toBe(result ? 2 : 0);
      });
    });

    it('frees the buffers growth retired', async () => {
      await withApp('view-unload-retired', (app) => {
        const { view3d } = buildScene(app);

        const bonePit = view3d._bonePit as unknown as { _retiredBuffers: unknown[] };
        const store = view3d._sceneBatch.storeBuffer as unknown as { _retiredBuffers: unknown[] };
        // Force one growth on each so there is something retired to free.
        growStores(view3d);
        app.render();
        expect(bonePit._retiredBuffers.length + store._retiredBuffers.length).toBeGreaterThan(0);

        view3d.unload();

        expect(bonePit._retiredBuffers.length).toBe(0);
        expect(store._retiredBuffers.length).toBe(0);
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

        const error = await renderCatchingValidationErrors(app);
        expect(error).toBe(null);
        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
      });
    });

    it('re-renders a manual-cadence light’s shadows after an unload', async () => {
      await withApp('view-unload-manual-shadow', (app) => {
        const { view3d, sun } = buildScene(app);

        // Manual mode is where the refresh request earns its keep: nothing in the scene
        // changes, so the cadence alone would let this light skip the frame that has to
        // redraw its layers into the map the unload threw away.
        sun.shadow.update = 'manual';
        sun.refreshShadows();
        app.render();
        app.render();
        const before = pixels(app, view3d);

        view3d.unload();
        app.render();

        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
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
        const error = await renderCatchingValidationErrors(app);
        expect(error).toBe(null);
        expect(differingPixels(before, pixels(app, view3d))).toBeGreaterThan(0);
      });
    });

    it('emits one `unload` event and is re-enrolled by the next render', async () => {
      await withApp('view-unload-event', (app) => {
        const { view3d } = buildScene(app);
        const uid = app.renderer.uid;
        // Enrolled in the renderer's GC: this renderer's global data in the payload slot and
        // pixi's one `unload` listener.
        const data = globalData(view3d, uid);
        expect(view3d.listenerCount('unload')).toBe(1);

        let unloadEvents = 0;
        const countUnloads = (): number => unloadEvents++;
        view3d.on('unload', countUnloads);
        view3d.unload();
        view3d.off('unload', countUnloads);

        // One event: pixi's hash answers it by running this renderer's payload, which frees the
        // global data without re-entering the View's teardown, and clears the slot along with
        // its once-listener.
        expect(unloadEvents).toBe(1);
        expectDestroyed(data);
        expect(view3d._gpuData[uid] ?? null).toBe(null);
        expect(view3d.listenerCount('unload')).toBe(0);

        app.render();
        expect(globalData(view3d, uid)).not.toBe(data);
        expect(view3d.listenerCount('unload')).toBe(1);
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
