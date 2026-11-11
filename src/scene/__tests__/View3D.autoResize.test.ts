import { getApp } from '@test-utils';
import { BlurFilter } from 'pixi.js';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { Scene3DSource } from '~/assets/Scene3DSource';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { View3D } from '~/scene/View3D';

function createTriangleSource(): Scene3DSource {
  const source = new Scene3DSource({
    scenes: [{ children: [0] }],
    nodes: [{ label: 'Tri', children: [], geometry: 0, materials: [0] }],
  });

  source.geometries[0] = [new Geometry3D({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) })];
  source.materials[0] = new Material3D({});

  return source;
}

describe('View3D autoResize option', () => {
  it('turns off when a size is set explicitly', () => {
    const bySetSize = new View3D({ autoResize: true });
    bySetSize.setSize(100, 50);
    expect(bySetSize.autoResize).toBe(false);

    const byWidth = new View3D({ autoResize: true });
    byWidth.width = 100;
    expect(byWidth.autoResize).toBe(false);

    const byHeight = new View3D({ autoResize: true });
    byHeight.height = 100;
    expect(byHeight.autoResize).toBe(false);
  });
});

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`View3D autoResize (${preference})`, () => {
    async function withApp(id: string, run: (app: Application<Renderer>) => void): Promise<void> {
      const app = await getApp<Renderer>({
        id: `${id}-${preference}`,
        appOptions: { preference, width: 400, height: 300 },
      });
      try {
        run(app);
      } finally {
        app.destroy();
      }
    }

    it('takes the screen size on render and follows a renderer resize', async () => {
      await withApp('auto-resize-follow', (app) => {
        const view = new View3D({ autoResize: true });
        app.stage.addChild(view);

        expect(view.getSize()).toEqual({ width: 256, height: 256 });

        app.render();
        expect(view.getSize()).toEqual({ width: 400, height: 300 });

        app.renderer.resize(200, 100);
        app.render();
        expect(view.getSize()).toEqual({ width: 200, height: 100 });
        expect(view.getBounds().width).toBe(200);
      });
    });

    it('stops following once autoResize is off', async () => {
      await withApp('auto-resize-off', (app) => {
        const view = new View3D({ autoResize: true });
        app.stage.addChild(view);
        app.render();

        view.autoResize = false;
        app.renderer.resize(200, 100);
        app.render();
        expect(view.getSize()).toEqual({ width: 400, height: 300 });
      });
    });

    it('sizes before the frame builds, so a filter covers the new rect', async () => {
      await withApp('auto-resize-filter', (app) => {
        const view = new View3D({ autoResize: true });
        view.filters = [new BlurFilter()];
        app.stage.addChild(view);

        let seen: { width: number; height: number } | undefined;
        view.onRender = () => {
          seen = view.getSize();
        };

        app.render();
        expect(seen).toEqual({ width: 400, height: 300 });
        expect(view.onRender).not.toBeNull();
      });
    });

    it('frames a View3D.from model on the first render, with the real aspect', async () => {
      await withApp('auto-resize-frame', (app) => {
        const view = View3D.from(createTriangleSource(), { autoResize: true });
        app.stage.addChild(view);

        expect(view.camera.position.z).toBe(0);

        app.render();
        expect(view.camera.position.z).toBeGreaterThan(0);

        const corner = view.worldToScreen({ x: 1, y: 1, z: 0 })!;
        expect(corner.x).toBeLessThanOrEqual(400);
        expect(corner.y).toBeGreaterThanOrEqual(0);
      });
    });
  });
}
