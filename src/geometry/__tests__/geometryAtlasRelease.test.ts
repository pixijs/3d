import { expectCleanRender, getApp } from '@test-utils';
import type { Buffer, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import type { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;
const CUBES_PAST_ATLAS_CAPACITY = 200;

function atlasVertexBuffer(geometry: Geometry3D): Buffer {
  return Object.values(geometry._geometryAtlasAllocation!.atlas.geometry.attributes)[0].buffer;
}

function cubeMesh(material: Material3D): Mesh3D {
  return new Mesh3D({ geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }), material });
}

function addView(stage: { addChild(child: View3D): unknown }, x: number): View3D {
  const view3d = new View3D({ width: SIZE, height: SIZE });
  view3d.position.set(x, 0);
  view3d.camera.position.set(0, 0, 3);
  stage.addChild(view3d);
  return view3d;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`geometry atlas release (${preference})`, () => {
    it('keeps a buffer growth replaced through that render, for a View that already drew from it, and frees it on the next', async () => {
      const app = await getApp<Renderer>({
        id: `geometry-atlas-release-growth-${preference}`,
        appOptions: { preference, width: SIZE * 2, height: SIZE, autoStart: false },
      });

      try {
        const material = new Material3D({ baseColor: 0x3388cc, metallic: 0, roughness: 0.5 });
        const first = cubeMesh(material);
        addView(app.stage, 0).root.addChild(first);
        const second = addView(app.stage, SIZE);
        await expectCleanRender(app);

        const outgrown = atlasVertexBuffer(first.geometry);
        for (let i = 0; i < CUBES_PAST_ATLAS_CAPACITY; i++) second.root.addChild(cubeMesh(material));
        await expectCleanRender(app);
        expect(atlasVertexBuffer(first.geometry), 'the second View grew the atlas').not.toBe(outgrown);
        expect(outgrown.destroyed).toBe(false);

        await expectCleanRender(app);
        expect(outgrown.destroyed).toBe(true);
      } finally {
        app.destroy(true, { children: true });
      }
    });

    it('frees a buffer growth replaced when the renderer is destroyed before another render', async () => {
      const app = await getApp<Renderer>({
        id: `geometry-atlas-release-destroy-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, autoStart: false },
      });
      const material = new Material3D({ baseColor: 0x3388cc, metallic: 0, roughness: 0.5 });
      const view3d = addView(app.stage, 0);
      const first = cubeMesh(material);
      view3d.root.addChild(first);
      await expectCleanRender(app);

      const outgrown = atlasVertexBuffer(first.geometry);
      for (let i = 0; i < CUBES_PAST_ATLAS_CAPACITY; i++) view3d.root.addChild(cubeMesh(material));
      await expectCleanRender(app);
      expect(outgrown.destroyed).toBe(false);

      app.destroy(true, { children: true });
      expect(outgrown.destroyed).toBe(true);
    });
  });
}
