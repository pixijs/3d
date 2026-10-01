import { expectCleanRender, getApp } from '@test-utils';
import { CanvasSource, Graphics, Texture } from 'pixi.js';
import type { Application, Renderer, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { ContainerTexture } from '~/core/textures/ContainerTexture';
import { NORMAL_MAP } from '~/core/textures/DefaultTextures';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

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

function residency(...sources: TextureSource[]): number {
  return gpuCopyCount(...(sources as unknown as GpuResident[]));
}

function makeTexture(color: string): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 4, 4);

  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

interface Scene {
  view3d: View3D;
  shared: Material3D;
  texture: Texture;
  left: Mesh3D;
  right: Mesh3D;
}

/** Two meshes sharing one textured material — the case that makes unload's reach visible. */
function buildScene(app: Application<Renderer>): Scene {
  const view3d = new View3D({ width: SIZE, height: SIZE });
  app.stage.addChild(view3d);

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 20, height: 20 }),
    material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
  });
  ground.position.set(0, -1.5, 0);
  ground.rotation.set(-Math.PI / 2, 0, 0);
  view3d.root.addChild(ground);

  const texture = makeTexture('#ff8800');
  const shared = new Material3D({ baseColorTexture: texture, metallic: 0, roughness: 0.5 });

  const geometry = new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 });
  const left = new Mesh3D({ geometry, material: shared });
  left.position.set(-1.6, 0, 0);
  const right = new Mesh3D({ geometry, material: shared });
  right.position.set(1.6, 0, 0);
  view3d.root.addChild(left, right);

  const sun = new DirectionalLight({ color: 0xfff4e0, intensity: 4 });
  sun.rotation.set((-55 * Math.PI) / 180, (55 * Math.PI) / 180, 0);
  view3d.root.addChild(sun);

  view3d.camera.position.set(0, 4, 9);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  app.render();

  return { view3d, shared, texture, left, right };
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

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`material unload (${preference})`, () => {
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

    it('frees the GPU copies of its own textures', async () => {
      await withApp('material-unload-textures', (app) => {
        const { shared, texture } = buildScene(app);

        expect(residency(texture.source)).toBeGreaterThan(0);

        shared.unload();

        expect(residency(texture.source)).toBe(0);
      });
    });

    it('leaves alone the process-wide default textures its unfilled slots fall back to', async () => {
      await withApp('material-unload-defaults', (app) => {
        const { shared, texture } = buildScene(app);

        const defaults = [Texture.WHITE, NORMAL_MAP].filter((fallback) => shared._textures.includes(fallback));
        expect(defaults.length).toBeGreaterThan(0);

        let defaultsUnloaded = 0;
        let ownUnloaded = 0;
        const countDefault = () => defaultsUnloaded++;
        const countOwn = () => ownUnloaded++;
        for (const fallback of defaults) fallback.source.on('unload', countDefault);
        texture.source.on('unload', countOwn);

        shared.unload();

        for (const fallback of defaults) fallback.source.off('unload', countDefault);
        texture.source.off('unload', countOwn);
        expect(defaultsUnloaded).toBe(0);
        expect(ownUnloaded).toBe(1);
      });
    });

    it('renders both meshes identically on the next frame', async () => {
      await withApp('material-unload-revive', async (app) => {
        const { view3d, shared, texture } = buildScene(app);
        const before = pixels(app, view3d);

        shared.unload();

        await expectCleanRender(app);
        expect(residency(texture.source)).toBeGreaterThan(0);
        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
      });
    });

    it('leaves a render-target-backed texture loaded and unloads the image-backed one beside it', async () => {
      await withApp('material-unload-rendered-source', async (app) => {
        const { view3d, left, right, texture } = buildScene(app);

        const stamp = new Graphics().rect(0, 0, 4, 4).fill(0x2266ff);
        const rendered = new ContainerTexture({ container: stamp, width: 4, height: 4, renderer: app.renderer });
        const mixed = new Material3D({
          baseColorTexture: rendered,
          metallicRoughnessTexture: texture,
          metallic: 0,
          roughness: 0.5,
        });
        left.material = mixed;
        right.material = mixed;
        app.render();
        const before = pixels(app, view3d);
        expect(residency(rendered.source)).toBeGreaterThan(0);
        expect(residency(texture.source)).toBeGreaterThan(0);

        mixed.unload();

        expect(residency(rendered.source)).toBeGreaterThan(0);
        expect(residency(texture.source)).toBe(0);

        await expectCleanRender(app);
        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
      });
    });

    it('keeps its store row, so the meshes still resolve their material', async () => {
      await withApp('material-unload-row', (app) => {
        const { shared } = buildScene(app);
        const row = shared._materialIndex;
        expect(row).toBeGreaterThanOrEqual(0);

        shared.unload();

        expect(shared._materialIndex).toBe(row);
      });
    });

    it('is idempotent, and a no-op on a material that never rendered', async () => {
      await withApp('material-unload-idempotent', (app) => {
        const { shared } = buildScene(app);

        shared.unload();
        expect(() => shared.unload()).not.toThrow();

        const fresh = new Material3D({ baseColor: 0x223344 });
        expect(() => fresh.unload()).not.toThrow();
      });
    });
  });
}
