import { getApp, readCanvasPixels } from '@test-utils';
import type { WebGLRenderer } from 'pixi.js';
import { BufferImageSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';
import type { CullMode } from '~/scene/View3D';

const SIZE = 64;

function spyOnIndexUploads(): { uploads: () => number } {
  const spy = vi.spyOn(BufferImageSource.prototype, 'update');

  return {
    uploads: () => spy.mock.contexts.filter((ctx) => (ctx as BufferImageSource).label === 'InstanceIndex').length,
  };
}

function buildView(count: number, cull: CullMode = 'cpu'): { view3d: View3D; meshes: Mesh3D[] } {
  const view3d = new View3D({ width: SIZE, height: SIZE, cull });
  view3d.camera.position.set(0, 0, 10);

  const geometry = new CubeGeometry({ width: 0.5, height: 0.5, depth: 0.5 });
  const material = new FlatMaterial({ baseColor: 0xff8844 });
  const meshes: Mesh3D[] = [];
  for (let i = 0; i < count; i++) {
    const mesh = new Mesh3D({ geometry, material });
    mesh.position.set(i - (count - 1) / 2, 0, 0);
    view3d.root.addChild(mesh);
    meshes.push(mesh);
  }

  return { view3d, meshes };
}

function drawnAt(pixels: Uint8ClampedArray, x: number, y: number): boolean {
  const i = (y * SIZE + x) * 4;

  return pixels[i] + pixels[i + 1] + pixels[i + 2] > 30;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WebGL instance index upload gate', () => {
  it.each(['cpu', 'gpu'] as const)(
    'uploads nothing on frames whose culled list is the one already on the GPU (cull %s)',
    async (cull) => {
      const app = await getApp<WebGLRenderer>({
        id: `gl-index-upload-unchanged-${cull}`,
        appOptions: { preference: 'webgl', width: SIZE, height: SIZE, backgroundColor: 0x000000 },
      });

      try {
        const { view3d } = buildView(5, cull);
        app.stage.addChild(view3d);
        app.render();

        const spy = spyOnIndexUploads();
        app.render();
        app.render();
        app.render();

        expect(spy.uploads(), 'the camera and the instances did not move').toBe(0);
      } finally {
        app.destroy();
      }
    },
  );

  it('control: a list that changed uploads again', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'gl-index-upload-changed',
      appOptions: { preference: 'webgl', width: SIZE, height: SIZE, backgroundColor: 0x000000 },
    });

    try {
      const { view3d, meshes } = buildView(5);
      app.stage.addChild(view3d);
      app.render();
      expect(drawnAt(readCanvasPixels(app.canvas), SIZE / 2, SIZE / 2)).toBe(true);

      const spy = spyOnIndexUploads();
      meshes[2].visible = false;
      app.render();
      const afterHide = spy.uploads();
      expect(afterHide, 'hiding the middle cube shifts the two after it').toBeGreaterThan(0);
      expect(drawnAt(readCanvasPixels(app.canvas), SIZE / 2, SIZE / 2), 'the middle cube is gone').toBe(false);

      meshes[2].visible = true;
      app.render();
      const afterShow = spy.uploads();
      expect(afterShow, 'showing it again shifts them back').toBeGreaterThan(afterHide);
      expect(drawnAt(readCanvasPixels(app.canvas), SIZE / 2, SIZE / 2), 'the middle cube is back').toBe(true);

      view3d.camera.position.set(400, 0, 10);
      app.render();
      expect(spy.uploads(), 'culling every cube writes no texel').toBe(afterShow);
      expect(drawnAt(readCanvasPixels(app.canvas), SIZE / 2, SIZE / 2)).toBe(false);

      view3d.camera.position.set(0, 0, 10);
      app.render();
      expect(spy.uploads(), 'the same survivors are already on the GPU').toBe(afterShow);
      expect(drawnAt(readCanvasPixels(app.canvas), SIZE / 2, SIZE / 2), 'the cubes are back').toBe(true);
    } finally {
      app.destroy();
    }
  });
});
