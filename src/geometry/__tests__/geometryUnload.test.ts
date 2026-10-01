import { expectCleanRender, getApp } from '@test-utils';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import type { Geometry3D } from '~/geometry/Geometry3D';
import { GeometryAtlasPool } from '~/geometry/GeometryAtlasPool';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

/** pixi keeps one GPU copy per renderer of a buffer, texture source or geometry layout, keyed by renderer uid. */
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

function bufferResidency(geometry: Geometry3D): number {
  return gpuCopyCount(...(geometry.buffers as unknown as GpuResident[]));
}

/** The GPU layouts (WebGL VAOs, WebGPU geometry records) recorded for a geometry drawn from its own buffers. */
function layoutResidency(geometry: Geometry3D): number {
  return gpuCopyCount(geometry as unknown as GpuResident);
}

/** The atlas internals these tests assert against; a vacated range shows up as dead space */
interface AtlasProbe {
  _deadVertexCount: number;
  _deadIndexCount: number;
}

interface Scene {
  view3d: View3D;
  cube: Mesh3D;
  cubeGeometry: Geometry3D;
  /** Unrelated to the cube; dirtied when a test needs the View's draw lists rebuilt */
  ground: Mesh3D;
}

/** A lit View at `x` holding a ground plane and an orange cube of `cubeGeometry`, rendered once */
function buildView(app: Application<Renderer>, x = 0, cubeGeometry?: Geometry3D): Scene {
  const view3d = new View3D({ width: SIZE, height: SIZE });
  view3d.position.set(x, 0);
  app.stage.addChild(view3d);

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 20, height: 20 }),
    material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
    castShadow: false,
  });
  ground.position.set(0, -1.5, 0);
  ground.rotation.set(-Math.PI / 2, 0, 0);
  view3d.root.addChild(ground);

  cubeGeometry ??= new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 });
  const cube = new Mesh3D({
    geometry: cubeGeometry,
    material: new Material3D({ baseColor: 0xff8800, metallic: 0, roughness: 0.5 }),
  });
  view3d.root.addChild(cube);

  const sun = new DirectionalLight({ color: 0xfff4e0, intensity: 4 });
  sun.rotation.set((-55 * Math.PI) / 180, (55 * Math.PI) / 180, 0);
  view3d.root.addChild(sun);

  view3d.camera.position.set(4, 5, 9);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  app.render();

  return { view3d, cube, cubeGeometry, ground };
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
  describe(`geometry unload (${preference})`, () => {
    /** The process-wide pool this backend packs into, reached the same way the pipe reaches it */
    const pool = (): GeometryAtlasPool => GeometryAtlasPool.from({ rebaseIndices: preference === 'webgl' });

    async function withApp(
      id: string,
      run: (app: Application<Renderer>) => Promise<void> | void,
      width = SIZE,
    ): Promise<void> {
      const app = await getApp<Renderer>({
        id: `${id}-${preference}`,
        appOptions: { preference, width, height: SIZE, backgroundColor: 0x101018 },
      });
      try {
        await run(app);
      } finally {
        app.destroy();
      }
    }

    it('leaves its atlas, vacating the packed range without versioning the pool', async () => {
      await withApp('geometry-unload-atlas-exit', (app) => {
        const { cube, cubeGeometry } = buildView(app);

        const allocation = cubeGeometry._geometryAtlasAllocation!;
        expect(allocation).toBeTruthy();
        const atlas = allocation.atlas as unknown as AtlasProbe;
        expect(atlas._deadVertexCount).toBe(0);
        const version = pool().bufferVersion;

        cube.removeFromParent();
        cubeGeometry.unload();

        expect(cubeGeometry._geometryAtlasAllocation).toBeNull();
        expect(atlas._deadVertexCount).toBe(allocation.vertexCount);
        expect(atlas._deadIndexCount).toBe(allocation.indexCount);
        expect(pool().bufferVersion).toBe(version);
      });
    });

    it('packs back into the atlas and renders identically when the mesh comes back', async () => {
      await withApp('geometry-unload-atlas-readd', (app) => {
        const { view3d, cube, cubeGeometry } = buildView(app);
        const before = pixels(app, view3d);

        cube.removeFromParent();
        cubeGeometry.unload();
        app.render();

        view3d.root.addChild(cube);
        app.render();

        expect(cubeGeometry._geometryAtlasAllocation).toBeTruthy();
        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
      });
    });

    it('frees the GPU copies of a dynamic geometry’s own buffers, and re-uploads on the next render', async () => {
      await withApp('geometry-unload-dynamic', (app) => {
        const { view3d } = buildView(app);

        const dynamic = new CubeGeometry({ width: 1, height: 1, depth: 1, dynamic: true });
        const mesh = new Mesh3D({
          geometry: dynamic,
          material: new Material3D({ baseColor: 0x22cc55, metallic: 0, roughness: 0.5 }),
        });
        mesh.position.set(2.5, 0, 0);
        view3d.root.addChild(mesh);
        app.render();

        const before = pixels(app, view3d);
        expect(bufferResidency(dynamic)).toBeGreaterThan(0);

        dynamic.unload();
        expect(bufferResidency(dynamic)).toBe(0);

        app.render();
        expect(bufferResidency(dynamic)).toBeGreaterThan(0);
        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
      });
    });

    it('is re-packed by the next frame on its own when unloaded while still in the scene, drawing identically', async () => {
      await withApp('geometry-unload-in-scene', (app) => {
        const { view3d, cubeGeometry } = buildView(app);
        const before = pixels(app, view3d);

        cubeGeometry.unload();
        expect(cubeGeometry._geometryAtlasAllocation).toBeNull();
        app.render();

        expect(cubeGeometry._geometryAtlasAllocation).toBeTruthy();
        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
      });
    });

    it('keeps a second View drawing a shared geometry, before and after that View rebuilds', async () => {
      await withApp(
        'geometry-unload-two-views',
        async (app) => {
          const { cubeGeometry } = buildView(app);
          const { view3d: viewB, ground } = buildView(app, SIZE, cubeGeometry);
          const before = pixels(app, viewB);

          cubeGeometry.unload();
          expect(cubeGeometry._geometryAtlasAllocation).toBeNull();

          await expectCleanRender(app);
          expect(cubeGeometry._geometryAtlasAllocation).toBeTruthy();
          expect(differingPixels(before, pixels(app, viewB))).toBe(0);

          ground.invalidate();
          await expectCleanRender(app);
          expect(differingPixels(before, pixels(app, viewB))).toBe(0);
        },
        SIZE * 2,
      );
    });

    it('is idempotent and survives a later destroy', async () => {
      await withApp('geometry-unload-idempotent', (app) => {
        const { cube, cubeGeometry } = buildView(app);

        cube.removeFromParent();
        cubeGeometry.unload();
        expect(() => cubeGeometry.unload()).not.toThrow();
        expect(() => cubeGeometry.destroy(true)).not.toThrow();
      });
    });

    it('is a no-op after a destroy that kept the buffers, which drops the layout but leaves the buffers loaded', async () => {
      await withApp('geometry-unload-after-destroy', (app) => {
        const { view3d } = buildView(app);

        const dynamic = new CubeGeometry({ width: 1, height: 1, depth: 1, dynamic: true });
        const mesh = new Mesh3D({
          geometry: dynamic,
          material: new Material3D({ baseColor: 0x22cc55, metallic: 0, roughness: 0.5 }),
        });
        view3d.root.addChild(mesh);
        app.render();
        const buffersBeforeDestroy = [...dynamic.buffers] as unknown as GpuResident[];
        expect(gpuCopyCount(...buffersBeforeDestroy)).toBeGreaterThan(0);

        mesh.removeFromParent();
        dynamic.destroy(false);

        expect(layoutResidency(dynamic)).toBe(0);
        expect(gpuCopyCount(...buffersBeforeDestroy)).toBeGreaterThan(0);
        expect(() => dynamic.unload()).not.toThrow();
      });
    });
  });
}
