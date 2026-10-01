import { getApp, readCanvasPixels } from '@test-utils';
import { GlobalResourceRegistry } from 'pixi.js';
import type { Application, Buffer, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { fullscreenTriangleGeometry } from '~/core/fullscreenTriangleGeometry';
import { TintEffect } from '~/extras/post-processing/effects/TintEffect';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

function positionBuffer(): Buffer {
  return fullscreenTriangleGeometry().attributes.aPosition.buffer;
}

/** A View with a cube and a tint effect, so it draws through both the output and a fullscreen pass */
function addView(app: Application<Renderer>, x: number): View3D {
  const view3d = new View3D({ width: SIZE, height: SIZE });
  view3d.x = x;
  view3d.passes = [new TintEffect({ tint: 0xff8888 })];
  view3d.root.addChild(
    new Mesh3D({
      geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 }),
      material: new Material3D({ baseColor: 0x44aaff, metallic: 0, roughness: 0.5 }),
    }),
  );
  view3d.camera.position.set(3, 3, 5);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  app.stage.addChild(view3d);
  return view3d;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`fullscreenTriangleGeometry (${preference})`, () => {
    it('outlives the passes that draw it, staying for a second View when the first View is destroyed', async () => {
      const app = await getApp<Renderer>({
        id: `fullscreen-triangle-${preference}`,
        appOptions: { preference, width: SIZE * 2, height: SIZE, backgroundColor: 0x101018 },
      });
      try {
        const first = addView(app, 0);
        addView(app, SIZE);
        app.render();

        const triangle = fullscreenTriangleGeometry();
        const before = readCanvasPixels(app.canvas, SIZE, 0, SIZE, SIZE);

        first.destroy({ children: true });
        app.render();

        expect(fullscreenTriangleGeometry()).toBe(triangle);
        expect(positionBuffer().destroyed).toBe(false);
        expect(readCanvasPixels(app.canvas, SIZE, 0, SIZE, SIZE)).toEqual(before);
      } finally {
        app.destroy();
      }
    });
  });
}

describe('fullscreenTriangleGeometry reset', () => {
  it('is destroyed by a global reset and rebuilt on the next call', () => {
    const triangle = fullscreenTriangleGeometry();
    const buffer = positionBuffer();

    GlobalResourceRegistry.release();

    expect(buffer.destroyed).toBe(true);
    expect(fullscreenTriangleGeometry()).not.toBe(triangle);
    expect(positionBuffer().destroyed).toBe(false);
  });
});
