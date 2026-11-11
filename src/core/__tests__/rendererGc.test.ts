import { captureWarnings, expectCleanRender, getApp, readCanvasPixels } from '@test-utils';
import { BufferImageSource, CanvasSource, CubeTexture, Sprite, Texture } from 'pixi.js';
import type { Application, ApplicationOptions, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { DrawCommandList } from '~/core/batcher/DrawCommandList';
import type { View3DPipeGl } from '~/core/gl/View3DPipeGl';
import type { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { TintEffect } from '~/extras/post-processing/effects/TintEffect';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';
import type { View3DGlobalData } from '~/scene/View3DGlobalData';

const SIZE = 128;
const WIDTH = 200;
const HEIGHT = 160;

interface ShadowPassProbe {
  _renderTarget: unknown;
}

function shadowPass(view3d: View3D): ShadowPassProbe {
  return view3d.passByBit[RenderPassBit.SHADOW] as unknown as ShadowPassProbe;
}

function opaquePass(view3d: View3D): ForwardRenderPass {
  return view3d.passByBit[RenderPassBit.OPAQUE] as ForwardRenderPass;
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

interface ForwardOptionsProbe {
  _forwardOptions: { session: unknown; camera: unknown; cullResults?: unknown };
}

interface BindOptionsProbe {
  _bindOptions: { target: unknown; frame?: unknown };
}

interface RenderTargetCacheProbe {
  _renderTargetCache: { _targets: Record<string, unknown> };
}

interface EnrolmentProbe {
  _managedViews: { _managedViews: { items: Record<number, View3D | null> } };
}

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

function pixels(app: Application<Renderer>): Uint8Array {
  return new Uint8Array(app.renderer.extract.pixels(app.stage).pixels);
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

function centreRgb(readback: Uint8Array): number[] {
  const offset = ((SIZE / 2) * SIZE + SIZE / 2) * 4;
  return [readback[offset], readback[offset + 1], readback[offset + 2]];
}

interface GcClocked {
  _gcLastUsed: number;
}

interface GcResource extends GcClocked {
  autoGarbageCollect?: boolean;
  _gpuData: Record<number, unknown>;
}

function engineResources(app: Application<Renderer>, view3d: View3D): GcResource[] {
  const pipe = (app.renderer.renderPipes as unknown as Record<string, View3DPipeGl>).view3d;
  const stores = [
    view3d._bonePit,
    view3d._sceneBatch.storeBuffer,
    pipe.geometryDataStoreBuffer,
    pipe._morphStoreBuffer,
  ];

  const resources: GcResource[] = [];
  const material = pipe.materialStoreBuffer.texture.source as unknown as GcResource;
  if (gpuCopies(material) > 0) resources.push(material);

  for (const store of stores) {
    const { _buffer, _textureSource } = store as unknown as { _buffer?: GcResource; _textureSource?: GcResource };
    for (const resource of [_buffer, _textureSource]) {
      if (resource && gpuCopies(resource) > 0) resources.push(resource);
    }
  }
  return resources;
}

function gpuCopies(resource: { _gpuData: Record<number, unknown> }): number {
  let n = 0;
  for (const uid in resource._gpuData) {
    if (resource._gpuData[uid]) n++;
  }
  return n;
}

function captures(list: DrawCommandList): Map<unknown, unknown> {
  return (list as unknown as { _captures: Map<unknown, unknown> })._captures;
}

function globalData(view3d: View3D, uid: number): View3DGlobalData {
  const data: View3DGlobalData | null = view3d._gpuData[uid] ?? null;
  expect(data).not.toBeNull();
  return data;
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

function forceGc(renderer: Renderer): void {
  const saved = renderer.gc.maxUnusedTime;
  renderer.gc.maxUnusedTime = -1;
  renderer.gc.run();
  renderer.gc.maxUnusedTime = saved;
}

function buildEffectScene(app: Application<Renderer>): View3D {
  const view3d = new View3D({ width: WIDTH, height: HEIGHT, passes: [new TintEffect()] });
  view3d.camera.position.z = 4;
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  view3d.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 1 }));
  view3d.root.addChild(
    new Mesh3D({
      geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 }),
      material: new Material3D({ baseColor: 0xffffff, roughness: 1 }),
    }),
  );
  app.stage.addChild(view3d);
  return view3d;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`renderer gc with a View3D (${preference})`, () => {
    async function withApp(
      id: string,
      run: (app: Application<Renderer>) => Promise<void> | void,
      appOptions: Partial<ApplicationOptions> = {},
    ): Promise<void> {
      const app = await getApp<Renderer>({
        id: `${id}-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x101018, ...appOptions },
      });
      try {
        await run(app);
      } finally {
        app.destroy();
      }
    }

    function collectIdleView(app: Application<Renderer>, view3d: View3D): void {
      app.stage.removeChild(view3d);
      app.render();
      app.render();
      collectStale(app.renderer, view3d);
    }

    function expectDestroyed(data: View3DGlobalData): void {
      expect(data.globalBindGroup.resources).toBeNull();
      const buffer = data.globalUniformGroup.buffer;
      expect(buffer?.destroyed).toBe(true);
    }

    function expectCollected(uid: number, view3d: View3D, data: View3DGlobalData): void {
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
        view3d._gpuData[uid] ?? null,
        "pixi's hash cleared this renderer's GC slot, so the next execute fills it again",
      ).toBe(null);
    }

    function expectReminted(app: Application<Renderer>, view3d: View3D, previous: View3DGlobalData): View3DGlobalData {
      const data = globalData(view3d, app.renderer.uid);
      expect(data, 'the next render makes new global data').not.toBe(previous);
      expect(view3d._gpuData[app.renderer.uid]).toBe(data);
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
        expectCollected(app.renderer.uid, view3d, data);

        app.stage.addChild(view3d);
        await expectCleanRender(app);
        expect(differingPixels(before, pixels(app))).toBe(0);
        expectReminted(app, view3d, data);
      });
    });

    it('keeps a live view through a sweep that collects idle 2D', async () => {
      await withApp('gc-coexistence', async (app) => {
        const { view3d, texture } = buildScene(app);

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
          "on the stage, pixi's tick refresh rewrote the View's backdated clock mid-sweep and kept its global data",
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
        expect(unloadEvents, "one event: pixi clearing the slot doesn't unload the view again").toBe(1);
        view3d.off('unload', countUnloads);
        expect(view3d.listenerCount('unload'), "the hash's once-listener went with the event").toBe(0);
        expectCollected(app.renderer.uid, view3d, data);

        await expectCleanRender(app);
        expect(differingPixels(before, pixels(app))).toBe(0);
        expectLoaded(view3d, texture);

        const reminted = expectReminted(app, view3d, data);
        expect(view3d.listenerCount('unload'), 'the render re-enrolled the View, so the GC owns it again').toBe(1);
        collectIdleView(app, view3d);
        expectCollected(app.renderer.uid, view3d, reminted);

        app.stage.addChild(view3d);
        expect(differingPixels(before, pixels(app))).toBe(0);
      });
    });

    it('keeps drawing its background after its last mesh leaves', async () => {
      await withApp('gc-empty-scene-background', async (app) => {
        const sky: [number, number, number] = [40, 160, 220];
        const view3d = new View3D({
          width: SIZE,
          height: SIZE,
          toneMapping: 'none',
          background: solidCubeTexture(...sky),
        });
        app.stage.addChild(view3d);
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
        expectCollected(app.renderer.uid, view3d, data);

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

    it('unloads every enrolled view when the renderer is destroyed, before the pipe frees its stores', async () => {
      const app = await getApp<Renderer>({
        id: `gc-renderer-destroy-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x101018 },
      });
      const { view3d, texture } = buildScene(app);
      const uid = app.renderer.uid;
      const data = globalData(view3d, uid);
      let unloadEvents = 0;
      view3d.on('unload', () => unloadEvents++);
      expectLoaded(view3d, texture);

      const warnings = captureWarnings(() => {
        expect(() => app.destroy()).not.toThrow();
      });
      expect(
        warnings.filter((text) => text.includes('[BindGroup]')),
        "the view destroyed this renderer's bind group before the pipe destroyed the LUT, environment maps and stores it held",
      ).toEqual([]);

      expect(unloadEvents, "a view renders with one renderer, so the renderer's teardown unloads the view").toBe(1);
      expectCollected(uid, view3d, data);

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

      const onDestroy = captureWarnings(() => environment.destroy(true));
      expect(onDestroy.filter((text) => text.includes('[BindGroup]'))).toEqual([]);

      view3d.destroy({ children: true });
      const onRendererDestroy = captureWarnings(() => app.destroy());
      expect(onRendererDestroy.filter((text) => text.includes('[BindGroup]'))).toEqual([]);
    });

    it('destroys without a bind-group warning', async () => {
      await withApp('gc-destroy-order', (app) => {
        const { view3d } = buildScene(app);
        app.render();

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

    it('keeps no session, camera or target in its reused draw and bind options once a frame has drawn', async () => {
      await withApp('gc-reused-options', (app) => {
        const { view3d } = buildScene(app);
        const forward = (app.renderer.renderPipes as unknown as Record<string, ForwardOptionsProbe>).view3d
          ._forwardOptions;
        expect(forward.session).toBeNull();
        expect(forward.camera).toBeNull();
        expect(forward.cullResults ?? null).toBeNull();

        const bind = (view3d._graph as unknown as BindOptionsProbe)._bindOptions;
        expect(bind.target).toBeNull();
        expect(bind.frame).toBeUndefined();
      });
    });

    it("drops the old size's render targets when the canvas resizes", async () => {
      await withApp(
        'gc-resize-targets',
        async (app) => {
          const view3d = buildEffectScene(app);
          app.render();
          const cache = (view3d._graph as unknown as RenderTargetCacheProbe)._renderTargetCache._targets;
          const targets = Object.keys(cache).length;
          for (let i = 1; i <= 8; i++) {
            app.renderer.resize(WIDTH + 13 * i, HEIGHT + 7 * i);
            view3d.width = app.screen.width;
            view3d.height = app.screen.height;
            app.render();
          }
          expect(Object.keys(cache).length, "a resize drops the old size's targets").toBe(targets);

          await expectCleanRender(app);
          app.render();
          const [r, g, b] = readCanvasPixels(app.canvas, app.screen.width / 2, app.screen.height / 2, 1, 1);
          expect(Math.max(r, g, b), 'draws after the resizes').toBeGreaterThan(128);
        },
        { width: WIDTH, height: HEIGHT, resolution: 1 },
      );
    });
  });
}
