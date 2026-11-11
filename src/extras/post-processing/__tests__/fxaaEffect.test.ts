import { getApp, readCanvasPixels } from '@test-utils';
import type { Application, Renderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { captureGraphDebugSnapshot } from '~/extras/debug/GraphDebugSnapshot';
import { FxaaEffect } from '~/extras/post-processing/effects/FxaaEffect';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

const PARTIAL_MARGIN = 16;

const GREY = 0xcccccc;

const FLOOR_ABOVE_GREY = 0.9;

interface EdgeReadout {
  partial: number;
  inside: number;
  outside: number;
}

interface QuadScene {
  page?: number;
  quad?: number;
  backdrop?: boolean;
}

async function withQuad<T>(
  preference: 'webgl' | 'webgpu',
  passes: FxaaEffect[],
  scene: QuadScene,
  run: (frame: () => Promise<EdgeReadout>) => Promise<T>,
): Promise<T> {
  const app: Application<Renderer> = await getApp<Renderer>({
    id: `fxaa-${preference}-${passes.length}`,
    appOptions: {
      preference,
      width: SIZE,
      height: SIZE,
      resolution: 1,
      antialias: false,
      backgroundColor: scene.page ?? 0x000000,
    },
  });

  try {
    expect(app.renderer.name).toBe(preference);

    const view3d = new View3D({ width: SIZE, height: SIZE, toneMapping: 'none', composite: true, passes });
    view3d.camera.position.set(0, 0, 3);

    const quad = new Mesh3D({
      geometry: new PlaneGeometry({ width: 1.6, height: 1.6 }),
      material: new FlatMaterial({ baseColor: scene.quad ?? 0xffffff }),
    });
    quad.rotation.set(0, 0, 0.12);
    view3d.root.addChild(quad);

    if (scene.backdrop) {
      const backdrop = new Mesh3D({
        geometry: new PlaneGeometry({ width: 20, height: 20 }),
        material: new FlatMaterial({ baseColor: 0x000000 }),
      });
      backdrop.position.set(0, 0, -1);
      view3d.root.addChild(backdrop);
    }
    app.stage.addChild(view3d);

    return await run(async () => {
      const device = (app.renderer as WebGPURenderer).gpu?.device;
      device?.pushErrorScope('validation');
      app.render();
      const pixels = readCanvasPixels(app.canvas);
      const error = device ? await device.popErrorScope() : null;
      expect(error?.message ?? null).toBe(null);

      const centre = ((SIZE >> 1) * SIZE + (SIZE >> 1)) * 4;
      const inside = pixels[centre];
      const outside = pixels[0];
      const low = Math.min(inside, outside) + PARTIAL_MARGIN;
      const high = Math.max(inside, outside) - PARTIAL_MARGIN;

      let partial = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] >= low && pixels[i] <= high) partial++;
      }

      return { partial, inside, outside };
    });
  } finally {
    app.destroy();
  }
}

function renderQuad(preference: 'webgl' | 'webgpu', passes: FxaaEffect[], scene: QuadScene = {}): Promise<EdgeReadout> {
  return withQuad(preference, passes, scene, (frame) => frame());
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`FxaaEffect (${preference})`, () => {
    it('blends the stair-stepped edges of a shape drawn without MSAA', async () => {
      const hard = await renderQuad(preference, []);
      const smoothed = await renderQuad(preference, [new FxaaEffect()]);

      expect(hard.partial).toBeLessThan(10);
      expect(smoothed.partial).toBeGreaterThan(100);
    });

    it('leaves pixels away from any edge untouched', async () => {
      const smoothed = await renderQuad(preference, [new FxaaEffect()]);

      expect(smoothed.inside).toBe(255);
      expect(smoothed.outside).toBe(0);
    });

    it('blends a black shape against the see-through part of a view over a white page', async () => {
      const smoothed = await renderQuad(preference, [new FxaaEffect()], { page: 0xffffff, quad: 0x000000 });

      expect(smoothed.partial).toBeGreaterThan(100);
    });

    it('stops blending an edge once edgeThresholdMin is raised past its contrast', async () => {
      const fxaa = new FxaaEffect();
      const { before, after } = await withQuad(preference, [fxaa], { quad: GREY, backdrop: true }, async (frame) => {
        const before = await frame();
        fxaa.edgeThresholdMin = FLOOR_ABOVE_GREY;

        return { before, after: await frame() };
      });

      expect(before.partial).toBeGreaterThan(100);
      expect(after.partial).toBeLessThan(10);
    });

    it("doesn't read the scene depth, so it doesn't keep it alive to the end of the frame", async () => {
      const app = await getApp<Renderer>({
        id: `fxaa-reads-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });
      try {
        const view3d = new View3D({ width: SIZE, height: SIZE, composite: true, passes: [new FxaaEffect()] });
        app.stage.addChild(view3d);
        app.render();

        const graph = view3d._graph;
        const fxaa = captureGraphDebugSnapshot(graph).passes.find((p) => p.name === 'FxaaEffect')!;
        expect(fxaa.accesses.map((a) => a.handleId)).not.toContain(graph.sceneDepth._id);
      } finally {
        app.destroy();
      }
    });
  });
}
