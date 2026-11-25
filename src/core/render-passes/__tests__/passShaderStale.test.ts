import { getApp } from '@test-utils';
import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { OutlinePass } from '~/extras/post-processing/passes/OutlinePass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import { RenderPassBit } from '../RenderPass';

const SIZE = 64;

type Renderer3D = WebGPURenderer | WebGLRenderer;

interface Scene {
  app: Awaited<ReturnType<typeof getApp<Renderer3D>>>;
  view3d: View3D;
  mesh: Mesh3D;
  sun: DirectionalLight;
}

async function drawnMesh(preference: 'webgpu' | 'webgl', id: string, sunCasts = true): Promise<Scene> {
  const app = await getApp<Renderer3D>({
    id: `pass-shader-stale-${id}-${preference}`,
    appOptions: { preference, width: SIZE, height: SIZE },
  });
  const view3d = new View3D({ width: SIZE, height: SIZE });
  view3d.camera.position.set(0, 0, 6);
  app.stage.addChild(view3d);

  const sun = new DirectionalLight({ intensity: 2, castShadow: sunCasts });
  sun.position.set(2, 5, 3);
  sun.lookAt({ x: 0, y: 0, z: 0 });
  const mesh = new Mesh3D({ geometry: new CubeGeometry(), material: new Material3D({ baseColor: 0xff7733 }) });
  view3d.root.addChild(sun, mesh);

  app.render();
  app.render();

  return { app, view3d, mesh, sun };
}

const KEEPS: Record<string, (scene: Scene) => void> = {
  'is taken out of the scene and put back': ({ app, view3d, mesh }) => {
    view3d.root.removeChild(mesh);
    app.render();
    view3d.root.addChild(mesh);
  },
  'stops casting a shadow and casts again': ({ app, mesh }) => {
    mesh.castShadow = false;
    app.render();
    mesh.castShadow = true;
  },
  "has its geometry's GPU copy unloaded": ({ mesh }) => {
    mesh.unload();
  },
};

const RESOLVES: Record<string, (scene: Scene) => void> = {
  'takes another geometry': ({ mesh }) => {
    mesh.geometry = new SphereGeometry();
  },
  'takes another material': ({ mesh }) => {
    mesh.material = new Material3D({ baseColor: 0x3377ff });
  },
  "has its material's alpha mode changed": ({ mesh }) => {
    mesh.material.alphaMode = 'mask';
  },
  'becomes a billboard': ({ mesh }) => {
    mesh.billboardMode = 'spherical';
  },
  'stops receiving shadows, then is put back in the scene': ({ app, view3d, mesh }) => {
    mesh.receiveShadow = false;
    view3d.root.removeChild(mesh);
    app.render();
    view3d.root.addChild(mesh);
  },
  'is invalidated': ({ mesh }) => {
    mesh.invalidate();
  },
  "has its view's fog turned on": ({ view3d }) => {
    view3d.fog = { type: 'linear', near: 1, far: 20, color: 0xffffff };
  },
  "has its view's tone mapping changed": ({ view3d }) => {
    view3d.toneMapping = 'reinhard';
  },
  "has its view's shadow filter changed": ({ view3d }) => {
    view3d.shadowFilter = 'hard';
  },
  'has a pass added to its view': ({ view3d }) => {
    view3d.passes = [new OutlinePass()];
  },
  'was out of the view while its tone mapping changed': ({ app, view3d, mesh }) => {
    view3d.root.removeChild(mesh);
    app.render();
    view3d.toneMapping = 'reinhard';
    app.render();
    view3d.root.addChild(mesh);
  },
  'moves to another view': ({ app, mesh }) => {
    const other = new View3D({ width: SIZE, height: SIZE, toneMapping: 'none' });
    app.stage.addChild(other);
    other.root.addChild(mesh);
  },
  "has its view's environment changed in kind": ({ view3d }) => {
    view3d.environment = { skyColor: 0xffffff, groundColor: 0x333333 };
  },
};

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`a mesh's shader is resolved again only when something that picks a bit changed (${preference})`, () => {
    for (const name in KEEPS) {
      it(`keeps its shader when it ${name}`, async () => {
        const scene = await drawnMesh(preference, `keeps-${Object.keys(KEEPS).indexOf(name)}`);

        try {
          const compileShader = vi.spyOn(scene.app.renderer.material3d, 'compileShader');
          const opaque = scene.mesh._passCache[RenderPassBit.OPAQUE].shader;
          const shadow = scene.mesh._passCache[RenderPassBit.SHADOW].shader;

          KEEPS[name](scene);
          scene.app.render();

          expect(compileShader, 'nothing that picks a bit changed').not.toHaveBeenCalled();
          expect(scene.mesh._passCache[RenderPassBit.OPAQUE].shader).toBe(opaque);
          expect(scene.mesh._passCache[RenderPassBit.SHADOW].shader).toBe(shadow);
        } finally {
          scene.app.destroy();
        }
      });
    }

    for (const name in RESOLVES) {
      it(`resolves its shader again when it ${name}`, async () => {
        const scene = await drawnMesh(preference, `resolves-${Object.keys(RESOLVES).indexOf(name)}`);

        try {
          const compileShader = vi.spyOn(scene.app.renderer.material3d, 'compileShader');

          RESOLVES[name](scene);
          scene.app.render();

          const resolved = compileShader.mock.calls.filter(([, item]) => item === scene.mesh);
          expect(resolved.length, 'the opaque and the shadow pass each resolved the mesh').toBeGreaterThanOrEqual(2);
        } finally {
          scene.app.destroy();
        }
      });
    }

    it('gives a mesh the shader of its changed settings, not the one it had', async () => {
      const scene = await drawnMesh(preference, 'shader');

      try {
        const { app, view3d, mesh } = scene;
        const lit = mesh._passCache[RenderPassBit.OPAQUE].shader;

        view3d.fog = { type: 'linear', near: 1, far: 20, color: 0xffffff };
        app.render();
        const fogged = mesh._passCache[RenderPassBit.OPAQUE].shader;
        expect(fogged, 'fog is a bit of its own').not.toBe(lit);

        view3d.fog = null;
        app.render();
        expect(mesh._passCache[RenderPassBit.OPAQUE].shader, 'and without it the first shader is back').toBe(lit);
      } finally {
        scene.app.destroy();
      }
    });

    it('resolves a receiver again when a light in its view casts shadows for the first time', async () => {
      const scene = await drawnMesh(preference, 'first-caster', false);

      try {
        const unshadowed = scene.mesh._passCache[RenderPassBit.OPAQUE].shader;

        scene.sun.castShadow = true;
        scene.app.render();
        scene.app.render();

        expect(scene.mesh._passCache[RenderPassBit.OPAQUE].shader, 'the receiver now samples the shadow map').not.toBe(
          unshadowed,
        );
      } finally {
        scene.app.destroy();
      }
    });

    it('resolves a batch slot again on its invalidate, and not when it leaves a pass and joins it again', async () => {
      const app = await getApp<Renderer3D>({
        id: `pass-shader-stale-slot-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE });
        view3d.camera.position.set(0, 0, 6);
        app.stage.addChild(view3d);

        const batched = new BatchedMesh3D({ size: 2 });
        batched.setGeometryAt(0, new CubeGeometry());
        batched.setMaterialAt(0, new Material3D({ baseColor: 0xff7733 }));
        batched.setPassesAt(0, RenderPassBit.OPAQUE);
        view3d.root.addChild(batched);
        app.render();

        const compileShader = vi.spyOn(app.renderer.material3d, 'compileShader');

        batched.setPassesAt(0, 0);
        app.render();
        batched.setPassesAt(0, RenderPassBit.OPAQUE);
        app.render();
        expect(compileShader, 'the slot only left the pass and came back').not.toHaveBeenCalled();

        batched.invalidate(0);
        app.render();
        expect(compileShader, 'an invalidate asks for the shader again').toHaveBeenCalledTimes(1);
      } finally {
        app.destroy();
      }
    });
  });
}
