import { getApp } from '@test-utils';
import { CubeTexture } from 'pixi.js';
import type { Renderer, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import type { View3D } from '~/scene/View3D';

import { scene } from '../../../tests/scenes/ibl-roughness.scene';

const RENDERERS = ['webgl', 'webgpu'] as const;

for (const preference of RENDERERS) {
  describe(`IBL roughness scene lifecycle (${preference})`, () => {
    it('releases its scene-owned resources when the harness destroys the app', async (context) => {
      const app = await getApp<Renderer>({
        id: `ibl-roughness-scene-lifecycle-${preference}`,
        appOptions: { preference, autoStart: false },
      });
      let appDestroyed = false;

      try {
        await scene.create(app, context);
        app.render();

        const view3d = app.stage.children[0] as View3D;
        const meshes = view3d.root.children.filter((child): child is Mesh3D => child instanceof Mesh3D);
        const materials = meshes.map((mesh) => mesh.material as Material3D);
        const geometry = meshes[0].geometry;
        const buffers = [...geometry.buffers];
        if (!(view3d.environment instanceof CubeTexture)) {
          throw new Error('The IBL roughness scene must use a cube environment');
        }
        const environment = view3d.environment;
        const cubeSource = environment.source;
        const faces = Object.values(cubeSource.faces) as TextureSource[];

        expect(geometry._geometryAtlasAllocation).not.toBeNull();

        appDestroyed = true;
        app.destroy();

        expect(view3d.environment).toBeNull();
        expect(view3d.destroyed).toBe(true);
        for (const mesh of meshes) expect(mesh.destroyed).toBe(true);
        for (const material of materials) expect(material.destroyed).toBe(true);
        expect(geometry._geometryAtlasAllocation).toBeNull();
        for (const buffer of buffers) expect(buffer.destroyed).toBe(true);
        expect(environment.destroyed).toBe(true);
        expect(cubeSource.destroyed).toBe(true);
        for (const face of faces) expect(face.destroyed).toBe(true);
      } finally {
        if (!appDestroyed) app.destroy();
      }
    });
  });
}
