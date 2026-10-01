import { captureWarnings, expectCleanRender, getApp } from '@test-utils';
import { BufferImageSource, CanvasSource, CubeTexture, Sprite, Texture } from 'pixi.js';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { DrawCommandList } from '~/core/batcher/DrawCommandList';
import type { View3DPipeGl } from '~/core/gl/View3DPipeGl';
import type { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';
import type { View3DGlobalData } from '~/scene/View3DGlobalData';

const SIZE = 128;

/** The one shadow-pass internal these tests assert against. */
interface ShadowPassProbe {
  _renderTarget: unknown;
}

function shadowPass(view3d: View3D): ShadowPassProbe {
  return view3d.passByBit[RenderPassBit.SHADOW] as unknown as ShadowPassProbe;
}

function opaquePass(view3d: View3D): ForwardRenderPass {
  return view3d.passByBit[RenderPassBit.OPAQUE] as ForwardRenderPass;
}

/** A collectable texture; pixi only auto-collects sources that opt in */
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

/** A cube map with one colour on all six faces, so a readback of it is orientation-free. */
function solidCubeTexture(r: number, g: number, b: number): CubeTexture {
  const face = (): Texture =>
    new Texture({
      source: new BufferImageSource({
        resource: new Uint8Array([r, g, b, 255]),
        format: 'rgba8unorm',
        width: 1,
        height: 1,
      }),
    });

  return CubeTexture.from({
    faces: { right: face(), left: face(), top: face(), bottom: face(), front: face(), back: face() },
  });
}

/** The pipe's enrolment registry and, inside it, pixi's `GCManagedHash` of enrolled Views. */
interface EnrolmentProbe {
  _managedViews: { _managedViews: { items: Record<number, View3D | null> } };
}

/** The `items` record of the pipe's GC hash, `null` where an entry has been cleared */
function managedViews(app: Application<Renderer>): Record<number, View3D | null> {
  const pipe = (app.renderer.renderPipes as unknown as Record<string, EnrolmentProbe>).view3d;
  return pipe._managedViews._managedViews.items;
}

interface Scene {
  view3d: View3D;
  texture: Texture;
  sun: DirectionalLight;
  ground: Mesh3D;
  cube: Mesh3D;
}

/**
 * A 2D + 3D app, rendered once so every test starts from a drawn frame: the View3D holds a
 * captured material texture and a shadow caster, and (unless `with2d` is off) a plain pixi Sprite
 * sits behind it so the renderer keeps drawing 2D while the View is out of the tree.
 */
function buildScene(app: Application<Renderer>, with2d = true): Scene {
  if (with2d) {
    const sprite = new Sprite(makeCollectableTexture('#224466'));
    sprite.width = sprite.height = SIZE;
    app.stage.addChild(sprite);
  }

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
  const cube = new Mesh3D({
    geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 }),
    material: new Material3D({ baseColorTexture: texture, metallic: 0, roughness: 0.5 }),
    castShadow: true,
  });
  view3d.root.addChild(cube);

  const sun = new DirectionalLight({ color: 0xfff4e0, intensity: 4, castShadow: true });
  sun.rotation.set((-55 * Math.PI) / 180, (55 * Math.PI) / 180, 0);
  view3d.root.addChild(sun);

  view3d.camera.position.set(4, 5, 9);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  app.render();

  return { view3d, texture, sun, ground, cube };
}

/**
 * Read the whole stage back, never the View alone. `extract` on a container runs
 * `enableRenderGroup()` on it, and a View3D that owns a render group is refreshed by pixi's
 * GC tick rescue on every sweep, so snapshotting the View directly would make it uncollectable
 * and quietly defeat the tests below.
 */
function pixels(app: Application<Renderer>): Uint8Array {
  return new Uint8Array(app.renderer.extract.pixels(app.stage).pixels);
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

/** RGB of the pixel at the centre of a `SIZE`-square readback. */
function centreRgb(readback: Uint8Array): number[] {
  const offset = ((SIZE / 2) * SIZE + SIZE / 2) * 4;
  return [readback[offset], readback[offset + 1], readback[offset + 2]];
}

/** Anything carrying pixi's GC idle clock: a texture source, a buffer, or a View3D */
interface GcClocked {
  _gcLastUsed: number;
}

/** A pixi resource carrying both a GC policy flag and per-renderer GPU copies. */
interface GcResource extends GcClocked {
  autoGarbageCollect?: boolean;
  _gpuData: Record<number, unknown>;
}

/**
 * The engine-owned stores that are actually holding GPU memory right now: the View's bone pit
 * and mesh store plus the pipe's shared material, morph and geometry stores. Each creates a buffer
 * and a data texture only when something binds them. WebGL reads every store's texture; WebGPU
 * binds the buffer, except for the material store, whose texture it reads. Which are resident
 * depends on the backend and on what the scene uses, so only resident ones come back.
 */
function engineResources(app: Application<Renderer>, view3d: View3D): GcResource[] {
  const pipe = (app.renderer.renderPipes as unknown as Record<string, View3DPipeGl>).view3d;
  const stores = [
    view3d._bonePit,
    view3d._sceneBatch.storeBuffer,
    pipe.materialStoreBuffer,
    pipe.geometryDataStoreBuffer,
    pipe._morphStoreBuffer,
  ];

  const resources: GcResource[] = [];
  for (const store of stores) {
    const { _buffer, _textureSource } = store as unknown as { _buffer?: GcResource; _textureSource?: GcResource };
    for (const resource of [_buffer, _textureSource]) {
      if (resource && gpuCopies(resource) > 0) resources.push(resource);
    }
  }
  return resources;
}

/** How many renderers hold a GPU copy of this resource; 0 once it has been collected */
function gpuCopies(resource: { _gpuData: Record<number, unknown> }): number {
  let n = 0;
  for (const uid in resource._gpuData) {
    if (resource._gpuData[uid]) n++;
  }
  return n;
}

/** The resources a pass's recorded build bakes: the list's capture map, by membership and size */
function captures(list: DrawCommandList): Map<unknown, unknown> {
  return (list as unknown as { _captures: Map<unknown, unknown> })._captures;
}

/** The renderer's global data on the View, minted by the first `execute` that drew it. */
function globalData(view3d: View3D, uid: number): View3DGlobalData {
  const data: View3DGlobalData | null = view3d._gpuData[uid] ?? null;
  expect(data).not.toBeNull();
  return data!;
}

/** Makes `resources` look idle by any threshold, unless a frame stamps them again */
function backdate(...resources: GcClocked[]): void {
  for (const resource of resources) resource._gcLastUsed = performance.now() - 100_000;
}

/**
 * Sweep with a 1s idle threshold after backdating `stale`'s clocks, so only those age out and
 * everything the last frame touched survives. The targeted recipe: it can tell a View the GC
 * should have rescued (its render-group tick refresh rewrites the clock during the sweep) from
 * one it should have collected. Without it, nothing is provable: pixi's real threshold is 60s
 * on a 30s cadence.
 */
function collectStale(renderer: Renderer, ...stale: GcClocked[]): void {
  const saved = renderer.gc.maxUnusedTime;
  renderer.gc.maxUnusedTime = 1000;
  backdate(...stale);
  renderer.gc.run();
  renderer.gc.maxUnusedTime = saved;
}

/**
 * Sweep everything the GC tracks, stale or not: a negative threshold fails the
 * `now - lastUsed < maxUnusedTime` test even for a resource touched this instant.
 *
 * Only safe in an app with no 2D content. Pixi's own 2D breaks under this: re-creating a GPU
 * buffer after a collection doesn't bump its resource id, so a pixi bind group keeps serving the
 * destroyed handle. That can't happen for real (a 2D batcher touches its buffers every frame, so
 * they never reach 60s idle), but it does happen when the threshold is forced negative.
 */
function forceGc(renderer: Renderer): void {
  const saved = renderer.gc.maxUnusedTime;
  renderer.gc.maxUnusedTime = -1;
  renderer.gc.run();
  renderer.gc.maxUnusedTime = saved;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`renderer gc with a View3D (${preference})`, () => {
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
     * Take the View out of the tree and age it out. Detached it has no parent render group, so
     * pixi's GC tick refresh can't rescue it and it goes the way of any idle renderable.
     */
    function collectIdleView(app: Application<Renderer>, view3d: View3D): void {
      app.stage.removeChild(view3d);
      app.render();
      app.render();
      collectStale(app.renderer, view3d);
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

    /**
     * Everything the collection payload had to give back. Asserted on every cycle: a pixi change
     * that made the sweep collect nothing would leave the revival checks passing vacuously.
     * `data` is this renderer's global data, captured before the collection.
     */
    function expectCollected(app: Application<Renderer>, view3d: View3D, data: View3DGlobalData): void {
      const opaque = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
      expect(opaque.commandList.count).toBe(0);
      expect(
        opaquePass(view3d).cullResults.get(view3d._sceneBatch)?.bundle ?? null,
        "the opaque pass's WebGPU bundle for the batch went (WebGL records none)",
      ).toBeNull();
      expect(shadowPass(view3d)._renderTarget).toBeNull();
      expect(captures(opaque.commandList).size, "the build's captures went with it").toBe(0);
      expectDestroyed(data);
      expect(
        view3d._gpuData[app.renderer.uid] ?? null,
        "pixi's hash ran this renderer's payload and cleared the slot, so the next execute mints a new one",
      ).toBe(null);
    }

    /** The render after a collection minted a fresh payload: a new object over a live buffer. */
    function expectReminted(app: Application<Renderer>, view3d: View3D, previous: View3DGlobalData): View3DGlobalData {
      const data = globalData(view3d, app.renderer.uid);
      expect(data).not.toBe(previous);
      expect(data.globalUniformGroup.buffer?.destroyed ?? false).toBe(false);
      return data;
    }

    function expectLoaded(view3d: View3D, texture: Texture): void {
      const opaque = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
      expect(opaque.commandList.count).toBeGreaterThan(0);
      expect(shadowPass(view3d)._renderTarget).not.toBeNull();
      expect(captures(opaque.commandList).has(texture.source)).toBe(true);
    }

    it('collects an idle view and revives it on the next render', async () => {
      await withApp('gc-idle-collect', async (app) => {
        const { view3d, texture } = buildScene(app);
        const before = pixels(app);
        expect(before.some((channel) => channel > 0)).toBe(true);
        expectLoaded(view3d, texture);
        const data = globalData(view3d, app.renderer.uid);

        collectIdleView(app, view3d);
        expectCollected(app, view3d, data);

        app.stage.addChild(view3d);
        await expectCleanRender(app);
        expect(differingPixels(before, pixels(app))).toBe(0);
        expectReminted(app, view3d, data);
      });
    });

    it('collects a revived view a second time', async () => {
      await withApp('gc-recollect', async (app) => {
        const { view3d, texture } = buildScene(app);
        const before = pixels(app);

        let data = globalData(view3d, app.renderer.uid);
        for (let cycle = 0; cycle < 2; cycle++) {
          collectIdleView(app, view3d);
          expectCollected(app, view3d, data);

          app.stage.addChild(view3d);
          await expectCleanRender(app);
          expect(differingPixels(before, pixels(app))).toBe(0);
          expectLoaded(view3d, texture);
          data = expectReminted(app, view3d, data);
        }
      });
    });

    it('keeps a live view through a sweep that collects idle 2D', async () => {
      await withApp('gc-coexistence', async (app) => {
        const { view3d, texture } = buildScene(app);

        /** A 2D texture uploaded once and then taken off the stage, so nothing keeps it in use */
        const idle = makeCollectableTexture('#00ff00');
        const idleSprite = new Sprite(idle);
        app.stage.addChild(idleSprite);
        app.render();
        expect(gpuCopies(idle.source)).toBeGreaterThan(0);
        idleSprite.removeFromParent();

        app.render();
        app.render();
        const before = pixels(app);
        const data = globalData(view3d, app.renderer.uid);

        collectStale(app.renderer, view3d, idle.source);

        expect(gpuCopies(idle.source), 'nothing rescues the idle texture').toBe(0);
        expectLoaded(view3d, texture);
        expect(
          globalData(view3d, app.renderer.uid),
          "on the stage, pixi's tick refresh rewrote the View's backdated clock mid-sweep and kept its payload",
        ).toBe(data);

        await expectCleanRender(app);
        expect(differingPixels(before, pixels(app))).toBe(0);
      });
    });

    it('keeps a drawn texture through a sweep that would take it idle', async () => {
      await withApp('gc-touch-drawn', async (app) => {
        const { view3d, texture } = buildScene(app);
        const before = pixels(app);
        expect(captures(view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE].commandList).has(texture.source)).toBe(true);

        backdate(texture.source);
        app.render();
        collectStale(app.renderer);

        expect(
          gpuCopies(texture.source),
          'the frame stamped the drawn texture as used, though a recorded bundle rebinds nothing',
        ).toBeGreaterThan(0);
        await expectCleanRender(app);
        expect(differingPixels(before, pixels(app))).toBe(0);
      });
    });

    it('lets a removed view’s textures age out and re-uploads them on its return', async () => {
      await withApp('gc-idle-texture', async (app) => {
        const { view3d, texture } = buildScene(app);
        const before = pixels(app);

        app.stage.removeChild(view3d);
        app.render();
        collectStale(app.renderer, texture.source);
        expect(gpuCopies(texture.source), "off the stage, the View's lingering build keeps nothing alive").toBe(0);

        app.stage.addChild(view3d);
        await expectCleanRender(app);
        expect(gpuCopies(texture.source)).toBeGreaterThan(0);
        expect(differingPixels(before, pixels(app))).toBe(0);
      });
    });

    it('survives a user-called unload while enrolled, and can still be collected after', async () => {
      await withApp('gc-user-unload', async (app) => {
        const { view3d, texture } = buildScene(app);
        const before = pixels(app);
        const data = globalData(view3d, app.renderer.uid);

        expect(view3d.listenerCount('unload'), "enrolled, pixi's hash holds the one unload listener").toBe(1);
        let unloadEvents = 0;
        const countUnloads = (): number => unloadEvents++;
        view3d.on('unload', countUnloads);

        expect(() => view3d.unload()).not.toThrow();
        expect(unloadEvents, "one event: the payload pixi runs from it doesn't re-enter the View's teardown").toBe(1);
        view3d.off('unload', countUnloads);
        expect(view3d.listenerCount('unload'), "the hash's once-listener went with the event").toBe(0);
        expectCollected(app, view3d, data);

        await expectCleanRender(app);
        expect(differingPixels(before, pixels(app))).toBe(0);
        expectLoaded(view3d, texture);

        const reminted = expectReminted(app, view3d, data);
        expect(view3d.listenerCount('unload'), 'the render re-enrolled the View, so the GC owns it again').toBe(1);
        collectIdleView(app, view3d);
        expectCollected(app, view3d, reminted);

        app.stage.addChild(view3d);
        expect(differingPixels(before, pixels(app))).toBe(0);
      });
    });

    it('keeps drawing its background after its last mesh leaves', async () => {
      await withApp('gc-empty-scene-background', async (app) => {
        /** The background's colour, which `none` tone mapping keeps the readback near */
        const sky: [number, number, number] = [40, 160, 220];
        const view3d = new View3D({
          width: SIZE,
          height: SIZE,
          toneMapping: 'none',
          background: solidCubeTexture(...sky),
        });
        app.stage.addChild(view3d);
        /**
         * Raises the mesh-slot high-water mark, which the empty-View early-out keys on, so the graph
         * keeps running once the cube leaves
         */
        const cube = new Mesh3D({
          geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
          material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.5 }),
        });
        view3d.root.addChild(cube);
        view3d.camera.position.set(0, 0, 5);
        view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
        app.render();

        view3d.root.removeChild(cube);
        await expectCleanRender(app);

        const centre = centreRgb(pixels(app));
        for (let c = 0; c < 3; c++)
          expect(
            Math.abs(centre[c] - sky[c]),
            'sky, not the clear colour, where the cube used to be',
          ).toBeLessThanOrEqual(12);
      });
    });

    it('revives after a sweep that collects every tracked resource', async () => {
      await withApp('gc-full-sweep', async (app) => {
        const { view3d } = buildScene(app, false);
        const before = pixels(app);
        const data = globalData(view3d, app.renderer.uid);

        app.stage.removeChild(view3d);
        app.render();
        forceGc(app.renderer);
        expectCollected(app, view3d, data);

        app.stage.addChild(view3d);
        await expectCleanRender(app);
        expect(differingPixels(before, pixels(app))).toBe(0);
        expectReminted(app, view3d, data);
      });
    });

    it('never collects the buffers the engine owns, which bundles and VAOs bake in and never re-fetch', async () => {
      await withApp('gc-exempt-buffers', async (app) => {
        const { view3d, texture } = buildScene(app);

        const idle = makeCollectableTexture('#00ff00');
        const idleSprite = new Sprite(idle);
        app.stage.addChild(idleSprite);
        app.render();
        idleSprite.removeFromParent();
        app.render();

        const engine = engineResources(app, view3d);
        expect(engine.length).toBeGreaterThan(0);
        for (const resource of engine) {
          expect(resource.autoGarbageCollect).toBe(false);
          expect(gpuCopies(resource)).toBeGreaterThan(0);
        }

        collectStale(app.renderer, idle.source, ...engine);

        expect(gpuCopies(idle.source), 'the idle texture went, so the sweep really ran').toBe(0);
        for (const resource of engine) expect(gpuCopies(resource)).toBeGreaterThan(0);
        expectLoaded(view3d, texture);
      });
    });

    it('unhooks an enrolled view when the renderer is destroyed, without unloading it', async () => {
      const app = await getApp<Renderer>({
        id: `gc-renderer-destroy-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x101018 },
      });
      const { view3d, texture } = buildScene(app);
      const uid = app.renderer.uid;
      const data = globalData(view3d, uid);
      let unloadEvents = 0;
      view3d.on('unload', () => unloadEvents++);

      const warnings = captureWarnings(() => {
        expect(() => app.destroy()).not.toThrow();
      });
      expect(
        warnings.filter((text) => text.includes('[BindGroup]')),
        "the payload ran before the pipe destroyed the LUT, environment maps and stores the View's bind groups hold",
      ).toEqual([]);

      expect(unloadEvents, 'never View3D.unload(), which is renderer-wide and would strip a second renderer').toBe(0);
      expectDestroyed(data);
      expect(view3d._gpuData[uid] ?? null).toBe(null);
      expect(shadowPass(view3d)._renderTarget).toBeNull();

      const opaque = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
      expect(opaque.commandList.count).toBeGreaterThan(0);
      expect(captures(opaque.commandList).has(texture.source)).toBe(true);

      expect(() => view3d.destroy({ children: true })).not.toThrow();
    });

    it('leaves no bind group over an environment once its IBL is generated', async () => {
      const app = await getApp<Renderer>({
        id: `gc-ibl-transients-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x101018 },
      });
      const { view3d } = buildScene(app);
      const environment = solidCubeTexture(120, 140, 160);
      view3d.environment = environment;
      app.render();

      /**
       * Prefiltering the environment and the BRDF LUT draw through one-shot bind groups; a group
       * left alive would keep listening to the source texture, its style and the batched UBO, and
       * warn as each dies
       */
      const onDestroy = captureWarnings(() => environment.destroy(true));
      expect(onDestroy.filter((text) => text.includes('[BindGroup]'))).toEqual([]);

      view3d.destroy({ children: true });
      /**
       * The style and pixi's batched uniform buffer such a group borrows die only with the
       * renderer; the View went first so its own state is out of the picture
       */
      const onRendererDestroy = captureWarnings(() => app.destroy());
      expect(onRendererDestroy.filter((text) => text.includes('[BindGroup]'))).toEqual([]);
    });

    it('destroys without a bind-group warning', async () => {
      await withApp('gc-destroy-order', (app) => {
        const { view3d } = buildScene(app);
        app.render();

        /**
         * Pixi warns from `BindGroup.onResourceChange` when a bound resource dies under a live bind
         * group, so `destroy` has to run the global data (through `unload`) before it frees the
         * light, shadow and bone buffers that group binds
         */
        const warnings = captureWarnings(() => view3d.destroy({ children: true }));
        expect(warnings.filter((text) => text.includes('[BindGroup]'))).toEqual([]);
      });
    });

    it('keeps a hidden but attached view through a sweep', async () => {
      await withApp('gc-hidden-attached', async (app) => {
        const { view3d, texture } = buildScene(app);
        const before = pixels(app);
        const data = globalData(view3d, app.renderer.uid);
        const hash = managedViews(app);

        view3d.visible = false;
        app.render();
        app.render();
        collectStale(app.renderer, view3d);

        expect(
          hash[view3d.uid],
          "hidden, it still hangs under the stage's render group, whose tick the sweep refreshes it from",
        ).toBe(view3d);
        expect(globalData(view3d, app.renderer.uid)).toBe(data);
        expectLoaded(view3d, texture);

        view3d.visible = true;
        await expectCleanRender(app);
        expect(differingPixels(before, pixels(app))).toBe(0);
      });
    });

    it('drops a pass’s captures as soon as its last renderable leaves it', async () => {
      await withApp('gc-pass-empties', async (app) => {
        const { view3d, texture, ground, cube } = buildScene(app);
        const opaque = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE].commandList;
        expect(captures(opaque).has(texture.source)).toBe(true);

        view3d.root.removeChild(cube);
        expect(
          captures(opaque).has(texture.source),
          'the ground still draws, so the texture stays captured until the next build sweeps it',
        ).toBe(true);

        view3d.root.removeChild(ground);
        expect(captures(opaque).size).toBe(0);

        view3d.root.addChild(ground);
        view3d.root.addChild(cube);
        await expectCleanRender(app);
        expect(captures(opaque).has(texture.source)).toBe(true);
      });
    });

    it('leaves the GC hash the moment it is destroyed', async () => {
      await withApp('gc-destroyed-view', async (app) => {
        const { view3d } = buildScene(app);
        const hash = managedViews(app);
        expect(hash[view3d.uid]).toBe(view3d);
        const data = globalData(view3d, app.renderer.uid);

        view3d.destroy({ children: true });
        expect(
          hash[view3d.uid] ?? null,
          "destroy's unload event had pixi's hash clear the entry at once, without waiting for a sweep",
        ).toBe(null);
        expectDestroyed(data);
        expect(view3d._gpuData[app.renderer.uid] ?? null).toBe(null);

        let unloadEvents = 0;
        view3d.on('unload', () => unloadEvents++);
        app.render();
        expect(() => collectStale(app.renderer, view3d)).not.toThrow();
        expect(unloadEvents, 'a later sweep found no entry, so made no unload call').toBe(0);
        expect(hash[view3d.uid] ?? null).toBe(null);

        await expectCleanRender(app);
      });
    });
  });
}
