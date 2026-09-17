import { getApp, isCI } from '@test-utils';
import type { Application, RenderTarget, Renderer, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { DEPTH_EMPTY } from '~/core/textures/DefaultTextures';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

/** The pass surface these tests drive, plus the one internal they assert against. */
interface ShadowPassProbe {
  targetVersion: number;
  unload(): void;
  _renderTarget: RenderTarget | null;
}

interface Scene {
  view3d: View3D;
  sun: DirectionalLight;
  caster: Mesh3D;
  pass: ShadowPassProbe;
}

function buildScene(app: Application<Renderer>): Scene {
  const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'low' });
  app.stage.addChild(view3d);

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 20, height: 20 }),
    material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
    castShadow: false,
  });
  ground.position.set(0, -0.5, 0);
  ground.rotation.set(-Math.PI / 2, 0, 0);
  view3d.root.addChild(ground);

  const caster = new Mesh3D({
    geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 }),
    material: new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.5 }),
    castShadow: true,
  });
  view3d.root.addChild(caster);

  const sun = new DirectionalLight({ color: 0xfff4e0, intensity: 4, castShadow: true });
  sun.rotation.set((-55 * Math.PI) / 180, (55 * Math.PI) / 180, 0);
  view3d.root.addChild(sun);

  view3d.camera.position.set(4, 6, 10);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  app.render();

  return { view3d, sun, caster, pass: view3d.passByBit[RenderPassBit.SHADOW] as unknown as ShadowPassProbe };
}

/** The source bound at the view's global shadow-map slot */
function boundShadowSource(app: Application<Renderer>, view3d: View3D): unknown {
  const pipe = (app.renderer as WebGLRenderer | WebGPURenderer).renderPipes.view3d;
  return view3d._gpuData[app.renderer.uid].globalBindGroup.getResource(pipe.globalSlots.shadowMap);
}

/** How many render bundles `run` records (WebGPU only) */
function bundlesRecorded(app: Application<Renderer>, run: () => void): number {
  const spy = vi.spyOn((app.renderer as WebGPURenderer).encoder, 'endBundle');
  try {
    run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

function pixels(app: Application<Renderer>, view3d: View3D): Uint8Array {
  return new Uint8Array(app.renderer.extract.pixels(view3d).pixels);
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

// The shadow map is the largest allocation a view owns (64 MB at the default tier), so a view must
// be able to give it back through `unload` and take it again without a crash or a changed picture.
// CI's GPU adapters are unreliable, so — like the scene suite — these run locally.
for (const preference of ['webgpu', 'webgl'] as const) {
  describe.skipIf(isCI)(`shadow target lifecycle (${preference})`, () => {
    async function withApp(id: string, run: (app: Application<Renderer>) => void): Promise<void> {
      const app = await getApp<Renderer>({
        id: `${id}-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });
      try {
        run(app);
      } finally {
        app.destroy();
      }
    }

    it('keeps the map while the pass is still needed', async () => {
      await withApp('shadow-release-live', (app) => {
        const { pass } = buildScene(app);
        const target = pass._renderTarget;
        const version = pass.targetVersion;

        app.render();
        app.render();

        expect(pass._renderTarget).toBe(target);
        expect(pass.targetVersion).toBe(version);
      });
    });

    it('unload() frees the map immediately and the next frame renders the same shadows', async () => {
      await withApp('shadow-unload-revive', (app) => {
        const { view3d, pass } = buildScene(app);

        app.render();
        const before = pixels(app, view3d);
        const version = pass.targetVersion;

        pass.unload();
        expect(pass._renderTarget).toBeNull();
        expect(pass.targetVersion).toBe(version + 1);
        expect(boundShadowSource(app, view3d)).toBe(DEPTH_EMPTY.source);

        // A fresh target holds no depth from the discarded one; the light's generation stamp is
        // what makes it re-render its layers rather than trust the layers it "already drew".
        app.render();
        expect(pass._renderTarget).not.toBeNull();

        const after = pixels(app, view3d);
        expect(differingPixels(before, after)).toBe(0);
      });
    });

    it('unload() is a no-op when no map is allocated', async () => {
      await withApp('shadow-unload-idempotent', (app) => {
        const { pass } = buildScene(app);

        pass.unload();
        const version = pass.targetVersion;
        expect(() => pass.unload()).not.toThrow();
        expect(pass.targetVersion).toBe(version);
      });
    });

    it('applies a quality change at the next frame boundary', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-quality-swap-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const { view3d, pass } = buildScene(app);

        const before = pass._renderTarget!;
        expect(before.depthStencilTexture!.width).toBe(512);

        // The view field is only applied at the frame boundary (`beginFrame`), so nothing frees
        // the map mid-frame — it stays bound and baked into recorded bundles until then.
        view3d.shadowQuality = 'high';
        expect(pass._renderTarget).toBe(before);

        const error = await renderCatchingValidationErrors(app);
        expect(error).toBe(null);

        expect(pass._renderTarget).not.toBe(before);
        expect(pass._renderTarget!.depthStencilTexture!.width).toBe(2048);
      } finally {
        app.destroy();
      }
    });

    it('re-renders a throttled light’s layers after a release', async () => {
      await withApp('shadow-unload-manual', (app) => {
        const { view3d, sun, pass } = buildScene(app);

        // Manual mode is where the generation stamp earns its keep: nothing in the scene changes,
        // so the cadence alone would let this light skip every frame after its first — including
        // the frame that has to redraw its layers into a map it has never drawn into.
        sun.shadow.update = 'manual';
        sun.refreshShadows();
        app.render();
        app.render();
        const before = pixels(app, view3d);

        pass.unload();
        app.render();

        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
      });
    });

    it('re-renders shadows for a light attached after a release', async () => {
      await withApp('shadow-release-late-light', (app) => {
        const { view3d, sun, pass } = buildScene(app);

        app.render();
        const before = pixels(app, view3d);

        view3d.root.removeChild(sun);
        pass.unload();
        app.render();

        view3d.root.addChild(sun);
        app.render();

        const after = pixels(app, view3d);
        expect(differingPixels(before, after)).toBe(0);
      });
    });

    it('renders through the placeholder after a release while the pass is culled', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-release-culled-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const { view3d, sun, pass } = buildScene(app);
        app.render();

        // Turning the caster off culls the shadow pass but keeps the forward program that
        // declares the shadow sampler, so the release leaves that program sampling the
        // DEPTH_EMPTY placeholder — which GL only accepts as a comparison texture.
        sun.castShadow = false;
        app.render();
        const before = pixels(app, view3d);

        pass.unload();
        expect(boundShadowSource(app, view3d)).toBe(DEPTH_EMPTY.source);

        const error = await renderCatchingValidationErrors(app);
        expect(error).toBe(null);
        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
      } finally {
        app.destroy();
      }
    });
  });
}

// A swapped map lives only in the global bind group, which every bundle bakes, so the frame that
// installs it has to re-record each of them — and only once: the bind that installs the map is the
// single invalidation, landing before any pass claims its bundle version for the frame.
describe.skipIf(isCI)('shadow map swap (webgpu)', () => {
  it('re-records every bundle exactly once per swap', async () => {
    const app = await getApp<Renderer>({
      id: 'shadow-swap-bundles-webgpu',
      appOptions: { preference: 'webgpu', width: SIZE, height: SIZE },
    });

    try {
      let scene!: Scene;
      const all = bundlesRecorded(app, () => {
        scene = buildScene(app);
      });
      expect(all).toBeGreaterThan(0);
      expect(bundlesRecorded(app, () => app.render())).toBe(0);

      scene.view3d.shadowQuality = 'high';
      expect(bundlesRecorded(app, () => app.render())).toBe(all);
      expect(bundlesRecorded(app, () => app.render())).toBe(0);

      scene.pass.unload();
      expect(bundlesRecorded(app, () => app.render())).toBe(all);
      expect(bundlesRecorded(app, () => app.render())).toBe(0);
    } finally {
      app.destroy();
    }
  });
});
