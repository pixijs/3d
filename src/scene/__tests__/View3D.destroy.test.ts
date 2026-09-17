import { getApp } from '@test-utils';
import type { Application, Buffer, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Geometry3D } from '~/geometry/Geometry3D';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Internal-field shape read by these tests. The owned GPU buffers are `@internal`
 * fields on View3D; reading them through this narrowing keeps the rest of the
 * test type-checked without an `as any`.
 */
interface View3DInternals {
  _bonePit: { buffer: Buffer };
  _lightDataBuffer: { bufferResource: { destroyed: boolean } };
  _shadowDataBuffer: { bufferResource: { destroyed: boolean } };
}

const RENDERERS = ['webgl', 'webgpu'] as const;

/** First attribute buffer (the underlying pixi `Buffer`) of a geometry. */
function positionBuffer(geometry: Geometry3D): Buffer {
  return geometry.attributes.aPosition.buffer;
}

/** Builds a populated View3D (meshes + shadow-casting light) and renders one frame. */
function buildScene(app: Application<WebGLRenderer | WebGPURenderer>): { view: View3D; meshes: Mesh3D[] } {
  const view = new View3D({ width: 512, height: 512 });
  app.stage.addChild(view);

  const meshes: Mesh3D[] = [];
  for (let i = 0; i < 3; i++) {
    const mesh = new Mesh3D({
      geometry: new SphereGeometry({ radius: 1 }),
      material: new Material3D({ baseColor: 0xff8844, metallic: 0.2, roughness: 0.6 }),
    });
    mesh.position.set((i - 1) * 2.5, 0, 0);
    view.root.addChild(mesh);
    meshes.push(mesh);
  }

  const light = new DirectionalLight({ intensity: 3, castShadow: true });
  light.position.set(5, 8, 5);
  light.lookAt({ x: 0, y: 0, z: 0 });
  view.root.addChild(light);

  view.camera.position.set(0, 2.5, 8);
  view.camera.lookAt({ x: 0, y: 0, z: 0 });

  // Force one synchronous frame so the graph builds and all GPU resources upload.
  app.render();

  return { view, meshes };
}

for (const preference of RENDERERS) {
  // oxlint-disable-next-line vitest/valid-title -- parametrising over both renderers by name
  describe(preference, () => {
    let app: Application<WebGLRenderer | WebGPURenderer> | undefined;

    afterEach(() => {
      // Tear each app down so contexts/canvases don't leak across cases.
      app?.destroy();
      app = undefined;
    });

    it('destroys without throwing and flips destroyed + owned GPU buffers', async () => {
      app = await getApp({ id: `view3d-destroy-${preference}`, appOptions: { preference } });
      const { view } = buildScene(app);

      const internals = view as unknown as View3DInternals;
      // Capture owned GPU resources before destroy: the bone pit nulls its
      // `buffer` ref on teardown, so the destroyed flag must be read off a
      // pre-captured reference.
      const bonePitBuffer = internals._bonePit.buffer;
      const lightResource = internals._lightDataBuffer.bufferResource;
      const shadowResource = internals._shadowDataBuffer.bufferResource;

      expect(bonePitBuffer.destroyed).toBe(false);

      expect(() => view.destroy()).not.toThrow();

      expect(view.destroyed).toBe(true);
      // The bone pit's underlying pixi Buffer is exclusively owned and always freed.
      expect(bonePitBuffer.destroyed).toBe(true);
      // Per-frame light/shadow buffer resources are owned and detached on destroy.
      expect(lightResource.destroyed).toBe(true);
      expect(shadowResource.destroyed).toBe(true);
    });

    it('leaves shared geometry intact on a plain destroy (children defaults off)', async () => {
      app = await getApp({ id: `view3d-destroy-shared-${preference}`, appOptions: { preference } });
      const { view, meshes } = buildScene(app);

      const geometry = meshes[0].geometry;
      const buffer = positionBuffer(geometry);
      const destroySpy = vi.spyOn(geometry, 'destroy');

      view.destroy();

      // Geometry is shared by default; a flagless destroy never reaches it.
      expect(destroySpy).not.toHaveBeenCalled();
      expect(buffer.destroyed).toBe(false);

      // Clean up the geometry the View left alone so it doesn't leak.
      geometry.destroy(true);
    });

    it('destroys owned geometry when children + geometry + material flags are set', async () => {
      app = await getApp({ id: `view3d-destroy-cascade-${preference}`, appOptions: { preference } });
      const { view, meshes } = buildScene(app);

      const buffers = meshes.map((m) => positionBuffer(m.geometry));
      for (const buffer of buffers) expect(buffer.destroyed).toBe(false);

      view.destroy({ children: true, geometry: true, material: true });

      // Cascading into the subtree with the geometry flag frees each mesh's geometry buffers.
      for (const buffer of buffers) expect(buffer.destroyed).toBe(true);
      for (const mesh of meshes) expect(mesh.destroyed).toBe(true);
    });

    it('destroys cleanly after rendering a transmissive material', async () => {
      app = await getApp({ id: `view3d-destroy-transmission-${preference}`, appOptions: { preference } });

      // End-to-end teardown smoke test through the transmission/refraction pass path,
      // which uses transient attachments and extra graph state. (The owned-target
      // RenderTargetCache teardown is unit-covered in RenderTargetCache.test.ts.)
      const view = new View3D({ width: 512, height: 512 });
      app.stage.addChild(view);

      const glass = new Mesh3D({
        geometry: new SphereGeometry({ radius: 1 }),
        material: new Material3D({
          baseColor: 0xffffff,
          roughness: 0.1,
          transmission: { factor: 1, thickness: 0.5 },
          ior: 1.5,
        }),
      });
      view.root.addChild(glass);

      view.camera.position.set(0, 0, 5);
      view.camera.lookAt({ x: 0, y: 0, z: 0 });
      app.render();

      expect(() => view.destroy({ children: true, geometry: true, material: true })).not.toThrow();
      expect(view.destroyed).toBe(true);
    });

    it('does not double-free geometry shared across meshes on a cascading destroy', async () => {
      app = await getApp({ id: `view3d-destroy-shared-geom-${preference}`, appOptions: { preference } });

      const view = new View3D({ width: 512, height: 512 });
      app.stage.addChild(view);

      // One geometry instance shared by several meshes (idiomatic instancing).
      const shared = new SphereGeometry({ radius: 1 });
      for (let i = 0; i < 3; i++) {
        const mesh = new Mesh3D({ geometry: shared, material: new Material3D({ baseColor: 0xff8844 }) });
        mesh.position.set((i - 1) * 2.5, 0, 0);
        view.root.addChild(mesh);
      }
      view.camera.position.set(0, 2.5, 8);
      view.camera.lookAt({ x: 0, y: 0, z: 0 });
      app.render();

      const buffer = positionBuffer(shared);

      // Cascading with the geometry flag would, without the Geometry3D
      // idempotency guard, call the non-idempotent pixi Geometry.destroy once
      // per mesh and throw on the second. It must free the shared geometry once.
      expect(() => view.destroy({ children: true, geometry: true, material: true })).not.toThrow();
      expect(buffer.destroyed).toBe(true);
    });

    it('detaches a retained root subtree from the freed scene batch on a flagless destroy', async () => {
      app = await getApp({ id: `view3d-destroy-detach-${preference}`, appOptions: { preference } });
      const localApp = app;
      const { view, meshes } = buildScene(localApp);

      const retained = meshes[0];
      // Attached to the view (its scene batch) after being added + rendered.
      expect(retained.view3d).toBe(view);

      // Flagless destroy: the subtree is left intact for the caller, but it must
      // be detached from the (always-freed) scene batch so it holds no stale ref.
      view.destroy();

      expect(view.destroyed).toBe(true);
      expect(retained.destroyed).toBe(false);
      expect(retained.view3d).toBeNull();

      // The retained mesh must be safe to reparent into a fresh view and render —
      // without the detach it would still point at the destroyed scene batch.
      const view2 = new View3D({ width: 256, height: 256 });
      localApp.stage.addChild(view2);
      view2.root.addChild(retained);
      view2.camera.position.set(0, 2.5, 8);
      view2.camera.lookAt({ x: 0, y: 0, z: 0 });
      expect(() => localApp.render()).not.toThrow();

      view2.destroy({ children: true, geometry: true, material: true });
      // meshes[1..] were detached (not destroyed) by the flagless destroy; free them.
      for (let i = 1; i < meshes.length; i++) meshes[i].destroy({ geometry: true, material: true });
    });

    it('invalidates a detached shadow light so it is reusable after a flagless destroy', async () => {
      app = await getApp({ id: `view3d-destroy-light-${preference}`, appOptions: { preference } });
      const localApp = app;

      const viewA = new View3D({ width: 512, height: 512 });
      localApp.stage.addChild(viewA);
      viewA.root.addChild(new Mesh3D({ geometry: new SphereGeometry({ radius: 1 }), material: new Material3D({}) }));
      const light = new DirectionalLight({ intensity: 3, castShadow: true });
      light.position.set(5, 8, 5);
      light.lookAt({ x: 0, y: 0, z: 0 });
      viewA.root.addChild(light);
      viewA.camera.position.set(0, 2.5, 8);
      viewA.camera.lookAt({ x: 0, y: 0, z: 0 });
      localApp.render(); // caches light._gpuShadowData binding viewA's bone pit (WebGPU)

      // Flagless destroy frees viewA's bone pit; the detached light's cached
      // shadow bind group must be invalidated so it doesn't dangle.
      viewA.destroy();
      expect(light.destroyed).toBe(false);
      expect(light._gpuShadowData).toBeNull();

      // Reusing the light in a fresh view must rebuild its shadow data and render
      // cleanly (it would otherwise bind viewA's freed bone-pit buffer).
      const viewB = new View3D({ width: 256, height: 256 });
      localApp.stage.addChild(viewB);
      viewB.root.addChild(new Mesh3D({ geometry: new SphereGeometry({ radius: 1 }), material: new Material3D({}) }));
      viewB.root.addChild(light);
      viewB.camera.position.set(0, 2.5, 8);
      viewB.camera.lookAt({ x: 0, y: 0, z: 0 });
      expect(() => localApp.render()).not.toThrow();

      viewB.destroy({ children: true, geometry: true, material: true });
    });

    it('is safe to call destroy twice', async () => {
      app = await getApp({ id: `view3d-destroy-twice-${preference}`, appOptions: { preference } });
      const { view } = buildScene(app);

      view.destroy();
      expect(() => view.destroy()).not.toThrow();
      expect(view.destroyed).toBe(true);
    });

    it('tears down cleanly through the pixi app.destroy path', async () => {
      app = await getApp({ id: `view3d-app-destroy-${preference}`, appOptions: { preference } });
      buildScene(app);

      const localApp = app;
      app = undefined; // hand off ownership so afterEach doesn't double-destroy
      expect(() => localApp.destroy()).not.toThrow();
    });
  });
}
