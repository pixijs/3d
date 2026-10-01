import { getApp } from '@test-utils';
import { CanvasSource, Texture } from 'pixi.js';
import type { Application, Renderer, TextureSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { Scene3DSource } from '~/assets/Scene3DSource';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import type { Geometry3D } from '~/geometry/Geometry3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { Container3D } from '~/scene/Container3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { Model3D } from '~/scene/Model3D';
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

/** A dynamic (non-atlased) mesh, so its geometry keeps GPU buffers of its own to give back. */
function makeMesh(texture: Texture, x: number): Mesh3D {
  const mesh = new Mesh3D({
    geometry: new CubeGeometry({ width: 1, height: 1, depth: 1, dynamic: true }),
    material: new Material3D({ baseColorTexture: texture, metallic: 0, roughness: 0.5 }),
  });
  mesh.position.set(x, 0, 0);
  return mesh;
}

function bufferResidency(geometry: Geometry3D): number {
  return gpuCopyCount(...(geometry.buffers as unknown as GpuResident[]));
}

function buildView(app: Application<Renderer>): View3D {
  const view3d = new View3D({ width: SIZE, height: SIZE });
  app.stage.addChild(view3d);

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 20, height: 20 }),
    material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
  });
  ground.position.set(0, -1.5, 0);
  ground.rotation.set(-Math.PI / 2, 0, 0);
  view3d.root.addChild(ground);

  const sun = new DirectionalLight({ color: 0xfff4e0, intensity: 4 });
  sun.rotation.set((-55 * Math.PI) / 180, (55 * Math.PI) / 180, 0);
  view3d.root.addChild(sun);

  view3d.camera.position.set(0, 4, 9);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  return view3d;
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
  describe(`scene unload (${preference})`, () => {
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

    it('unloads a mesh’s geometry and leaves its shared material alone', async () => {
      await withApp('mesh-unload-geometry-only', (app) => {
        const view3d = buildView(app);
        const texture = makeTexture('#ff8800');
        const mesh = makeMesh(texture, 0);
        view3d.root.addChild(mesh);
        app.render();

        expect(bufferResidency(mesh.geometry)).toBeGreaterThan(0);
        expect(residency(texture.source)).toBeGreaterThan(0);

        mesh.removeFromParent();
        mesh.unload();

        expect(bufferResidency(mesh.geometry)).toBe(0);
        expect(residency(texture.source)).toBeGreaterThan(0);
      });
    });

    it('re-packs an atlased geometry the frame after unloading a mesh that stayed in the scene', async () => {
      await withApp('mesh-unload-in-scene', (app) => {
        const view3d = buildView(app);
        const mesh = new Mesh3D({
          geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 }),
          material: new Material3D({ baseColor: 0xff8800, metallic: 0, roughness: 0.5 }),
        });
        view3d.root.addChild(mesh);
        app.render();
        const before = pixels(app, view3d);

        mesh.unload();
        expect(mesh.geometry._geometryAtlasAllocation).toBeNull();

        app.render();

        expect(mesh.geometry._geometryAtlasAllocation).toBeTruthy();
        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
      });
    });

    it('walks a nested container down to every mesh, unloading geometry but leaving the shared materials', async () => {
      await withApp('container-unload-walk', (app) => {
        const view3d = buildView(app);
        const texture = makeTexture('#44aaff');

        const group = new Container3D();
        const inner = new Container3D();
        const near = makeMesh(texture, -1.6);
        const deep = makeMesh(texture, 1.6);
        inner.addChild(deep);
        group.addChild(near, inner);
        view3d.root.addChild(group);
        app.render();

        expect(bufferResidency(near.geometry)).toBeGreaterThan(0);
        expect(bufferResidency(deep.geometry)).toBeGreaterThan(0);

        group.removeFromParent();
        group.unload();

        expect(bufferResidency(near.geometry)).toBe(0);
        expect(bufferResidency(deep.geometry)).toBe(0);
        expect(residency(texture.source)).toBeGreaterThan(0);
      });
    });

    it('gives back a batched mesh’s slot geometry and re-packs it next frame', async () => {
      await withApp('batched-unload', (app) => {
        const view3d = buildView(app);

        const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
        const batched = new BatchedMesh3D({ size: 2 });
        for (let i = 0; i < 2; i++) {
          batched.setGeometryAt(i, geometry);
          batched.setMaterialAt(i, new Material3D({ baseColor: 0xdd4444, metallic: 0, roughness: 0.5 }));
          batched.setMatrixAt(i, new Matrix4().setPosition({ x: i * 2 - 1, y: 0, z: 0 }));
          batched.setItemActive(i, RenderPassBit.OPAQUE);
        }
        view3d.root.addChild(batched);
        app.render();
        const before = pixels(app, view3d);

        batched.unload();
        expect(geometry._geometryAtlasAllocation).toBeNull();

        app.render();

        expect(geometry._geometryAtlasAllocation).toBeTruthy();
        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
      });
    });

    it('gives back a model’s geometry and its materials’ textures, unloading a shared material once', async () => {
      await withApp('model-unload', (app) => {
        const view3d = buildView(app);
        const skin = makeTexture('#ff8800');
        const trim = makeTexture('#44aaff');

        const model = new Model3D(new Scene3DSource({}));
        const body = makeMesh(skin, -1.6);
        const arm = makeMesh(skin, 0);
        const badge = makeMesh(trim, 1.6);
        arm.material = body.material;
        const limb = new Container3D();
        limb.addChild(arm);
        model.addChild(body, limb, badge);
        view3d.root.addChild(model);
        app.render();

        let skinUnloads = 0;
        const countSkin = () => skinUnloads++;
        skin.source.on('unload', countSkin);

        model.removeFromParent();
        model.unload();
        skin.source.off('unload', countSkin);

        expect(skinUnloads).toBe(1);
        expect(residency(skin.source)).toBe(0);
        expect(residency(trim.source)).toBe(0);
        expect(bufferResidency(body.geometry)).toBe(0);
        expect(bufferResidency(arm.geometry)).toBe(0);
        expect(bufferResidency(badge.geometry)).toBe(0);
      });
    });

    it('unloads a nested model’s materials once, through a plain container between the two models', async () => {
      await withApp('model-unload-nested', (app) => {
        const view3d = buildView(app);
        const outerSkin = makeTexture('#ff8800');
        const innerSkin = makeTexture('#44aaff');

        const outer = new Model3D(new Scene3DSource({}));
        const inner = new Model3D(new Scene3DSource({}));
        const outerMesh = makeMesh(outerSkin, -1.6);
        const innerMesh = makeMesh(innerSkin, 1.6);
        inner.addChild(innerMesh);
        const mount = new Container3D();
        mount.addChild(inner);
        outer.addChild(outerMesh, mount);
        view3d.root.addChild(outer);
        app.render();

        const outerUnload = vi.spyOn(outerMesh.material, 'unload');
        const innerUnload = vi.spyOn(innerMesh.material, 'unload');
        let innerChanges = 0;
        const countChange = () => innerChanges++;
        innerSkin.source.on('change', countChange);

        try {
          outer.removeFromParent();
          outer.unload();
          innerSkin.source.off('change', countChange);

          expect(outerUnload).toHaveBeenCalledTimes(1);
          expect(innerUnload).toHaveBeenCalledTimes(1);
          expect(innerChanges).toBe(1);
          expect(residency(outerSkin.source)).toBe(0);
          expect(residency(innerSkin.source)).toBe(0);
        } finally {
          outerUnload.mockRestore();
          innerUnload.mockRestore();
        }
      });
    });

    it('renders a model identically after unloading and re-adding it', async () => {
      await withApp('model-unload-revive', (app) => {
        const view3d = buildView(app);
        const texture = makeTexture('#ff8800');

        const model = new Model3D(new Scene3DSource({}));
        model.addChild(makeMesh(texture, -1.6), makeMesh(texture, 1.6));
        view3d.root.addChild(model);
        app.render();
        const before = pixels(app, view3d);

        model.removeFromParent();
        model.unload();
        app.render();

        view3d.root.addChild(model);
        app.render();

        expect(differingPixels(before, pixels(app, view3d))).toBe(0);
      });
    });
  });
}
