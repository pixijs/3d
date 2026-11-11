import { expectCleanRender, getApp, isCI } from '@test-utils';
import type { Application, RenderTarget, Renderer, WebGPURenderer } from 'pixi.js';
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
  const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'low', cull: 'off' });
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

function boundShadowSource(app: Application<Renderer>, view3d: View3D): unknown {
  const { group, slot } = view3d._gpuData[app.renderer.uid].globalTextureBindings.shadowMap;
  return group.getResource(slot);
}

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
  describe.skipIf(isCI)(`shadow map unload and re-creation, with no crash or changed picture (${preference})`, () => {
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

    it('unload() frees the map immediately and the next frame renders the same shadows', async () => {
      await withApp('shadow-unload-revive', (app) => {
        const { view3d, pass } = buildScene(app);

        app.render();
        const before = pixels(app, view3d);
        const version = pass.targetVersion;
        const map = pass._renderTarget!.depthStencilTexture!;

        pass.unload();
        expect(pass._renderTarget).toBeNull();
        expect(map.destroyed, 'the pass owns the map, so destroying the target alone would leak it').toBe(true);
        expect(pass.targetVersion).toBe(version + 1);
        expect(boundShadowSource(app, view3d)).toBe(DEPTH_EMPTY.source);

        app.render();
        expect(pass._renderTarget).not.toBeNull();

        const after = pixels(app, view3d);
        expect(
          differingPixels(before, after),
          "the light's target version makes it redraw its layers into the fresh, empty map",
        ).toBe(0);
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
        const beforeMap = before.depthStencilTexture!;
        expect(beforeMap.width).toBe(512);

        view3d.shadowQuality = 'high';
        expect(pass._renderTarget, 'nothing frees the map mid-frame, while bundles still bake it').toBe(before);

        await expectCleanRender(app);

        expect(pass._renderTarget).not.toBe(before);
        expect(pass._renderTarget!.depthStencilTexture!.width).toBe(2048);
        expect(beforeMap.destroyed).toBe(true);
      } finally {
        app.destroy();
      }
    });

    it('re-renders a manual light’s layers after a release, though its cadence would skip that frame', async () => {
      await withApp('shadow-unload-manual', (app) => {
        const { view3d, sun, pass } = buildScene(app);

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

    it('renders through the comparison placeholder after a release while the pass is skipped and the shader still samples', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-release-culled-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const { view3d, sun, pass } = buildScene(app);
        app.render();

        sun.castShadow = false;
        app.render();
        const before = pixels(app, view3d);

        pass.unload();
        expect(boundShadowSource(app, view3d)).toBe(DEPTH_EMPTY.source);

        await expectCleanRender(app);
        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
      } finally {
        app.destroy();
      }
    });
  });
}

describe.skipIf(isCI)('shadow map swap (webgpu)', () => {
  it('re-records every bundle, which bakes the global bind group, exactly once per swap', async () => {
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
