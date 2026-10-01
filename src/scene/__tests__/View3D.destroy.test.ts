import { getApp } from '@test-utils';
import type { Application, Buffer, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Geometry3D } from '~/geometry/Geometry3D';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const RENDERERS = ['webgl', 'webgpu'] as const;

/** The pixi `Buffer` behind a geometry's `aPosition` attribute */
function positionBuffer(geometry: Geometry3D): Buffer {
  return geometry.attributes.aPosition.buffer;
}

/**
 * Builds a View3D with three meshes and a shadow-casting light, and renders a frame so its graph
 * and GPU resources exist
 */
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

  app.render();

  return { view, meshes };
}

for (const preference of RENDERERS) {
  // oxlint-disable-next-line vitest/valid-title -- parametrising over both renderers by name
  describe(preference, () => {
    let app: Application<WebGLRenderer | WebGPURenderer> | undefined;

    afterEach(() => {
      app?.destroy();
      app = undefined;
    });

    it('destroys without throwing, flags itself destroyed, and frees the bone pit buffer it owns', async () => {
      app = await getApp({ id: `view3d-destroy-${preference}`, appOptions: { preference } });
      const { view } = buildScene(app);

      /** Read before the destroy, which drops the bone pit's reference to its buffer */
      const bonePitBuffer = view._bonePit.buffer;

      expect(bonePitBuffer.destroyed).toBe(false);

      expect(() => view.destroy()).not.toThrow();

      expect(view.destroyed).toBe(true);
      expect(bonePitBuffer.destroyed).toBe(true);
    });

    it('leaves shared geometry intact on a plain destroy (children defaults off)', async () => {
      app = await getApp({ id: `view3d-destroy-shared-${preference}`, appOptions: { preference } });
      const { view, meshes } = buildScene(app);

      const geometry = meshes[0].geometry;
      const buffer = positionBuffer(geometry);
      const destroySpy = vi.spyOn(geometry, 'destroy');

      view.destroy();

      expect(destroySpy).not.toHaveBeenCalled();
      expect(buffer.destroyed).toBe(false);

      geometry.destroy(true);
    });

    it('destroys owned geometry when children + geometry + material flags are set', async () => {
      app = await getApp({ id: `view3d-destroy-cascade-${preference}`, appOptions: { preference } });
      const { view, meshes } = buildScene(app);

      const buffers = meshes.map((m) => positionBuffer(m.geometry));
      for (const buffer of buffers) expect(buffer.destroyed).toBe(false);

      view.destroy({ children: true, geometry: true, material: true });

      for (const buffer of buffers) expect(buffer.destroyed).toBe(true);
      for (const mesh of meshes) expect(mesh.destroyed).toBe(true);
    });

    it('destroys a geometry shared by several meshes only once', async () => {
      app = await getApp({ id: `view3d-destroy-shared-geom-${preference}`, appOptions: { preference } });

      const view = new View3D({ width: 512, height: 512 });
      app.stage.addChild(view);

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

      expect(
        () => view.destroy({ children: true, geometry: true, material: true }),
        'pixi’s Geometry.destroy throws on a second call',
      ).not.toThrow();
      expect(buffer.destroyed).toBe(true);
    });

    it('detaches a retained root subtree from the freed scene batch on a flagless destroy', async () => {
      app = await getApp({ id: `view3d-destroy-detach-${preference}`, appOptions: { preference } });
      const localApp = app;
      const { view, meshes } = buildScene(localApp);

      const retained = meshes[0];
      expect(retained.view3d).toBe(view);

      view.destroy();

      expect(view.destroyed).toBe(true);
      expect(retained.destroyed).toBe(false);
      expect(retained.view3d).toBeNull();

      const view2 = new View3D({ width: 256, height: 256 });
      localApp.stage.addChild(view2);
      view2.root.addChild(retained);
      view2.camera.position.set(0, 2.5, 8);
      view2.camera.lookAt({ x: 0, y: 0, z: 0 });
      expect(() => localApp.render(), 'the retained mesh renders in a new view').not.toThrow();

      view2.destroy({ children: true, geometry: true, material: true });
      for (let i = 1; i < meshes.length; i++) meshes[i].destroy({ geometry: true, material: true });
    });

    it('drops a detached light’s shadow data, so a new view can reuse the light', async () => {
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
      localApp.render();

      viewA.destroy();
      expect(light.destroyed).toBe(false);
      expect(light._gpuShadowData, 'its WebGPU shadow bundles bake the freed bone pit').toBeNull();

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
  });
}
