import { getApp, renderFrame } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CameraData, getCameraData } from '~/core/CameraData';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { Vector3 } from '~/math/vector/Vector3';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

function ndc(projection: Matrix4, x: number, y: number, z: number): [number, number] {
  const e = projection.elements;
  const w = e[3] * x + e[7] * y + e[11] * z + e[15];
  return [(e[0] * x + e[4] * y + e[8] * z + e[12]) / w, (e[1] * x + e[5] * y + e[9] * z + e[13]) / w];
}

describe('CameraData jitter', () => {
  const view = new Matrix4();
  const position = new Vector3();

  it('moves the image by the same NDC offset at every depth, perspective and orthographic alike', () => {
    for (const projection of [
      new Matrix4().makePerspective(1, 1, 0.5, 40),
      new Matrix4().makeOrthographic(-5, 5, 5, -5, 0.5, 40),
    ]) {
      const plain = new CameraData().set(position, view, projection);
      const jittered = new CameraData().set(position, view, projection, false, false, { x: 0.01, y: -0.02 });

      for (const z of [-0.5, -3, -39]) {
        const [x0, y0] = ndc(plain.projection, 0.3, -0.2, z);
        const [x1, y1] = ndc(jittered.projection, 0.3, -0.2, z);
        expect(x1 - x0).toBeCloseTo(0.01, 6);
        expect(y1 - y0).toBeCloseTo(-0.02, 6);
      }
    }
  });

  it('shifts before the flip, so the offset points the same way on screen either way', () => {
    const projection = new Matrix4().makePerspective(1, 1, 0.5, 40);
    const plain = new CameraData().set(position, view, projection, true);
    const jittered = new CameraData().set(position, view, projection, true, false, { x: 0, y: 0.02 });

    const [, y0] = ndc(plain.projection, 0, 0, -3);
    const [, y1] = ndc(jittered.projection, 0, 0, -3);
    expect(y1 - y0).toBeCloseTo(-0.02, 6);
  });
});

function coverage(pixels: Uint8ClampedArray, size: number): { columns: number; rows: number } {
  let columns = 0;
  let rows = 0;
  const probe = Math.floor(size / 4);
  for (let x = 0; x < size; x++) if (pixels[(probe * size + x) * 4] > 128) columns++;
  for (let y = 0; y < size; y++) if (pixels[(y * size + probe) * 4] > 128) rows++;
  return { columns, rows };
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`Camera3D.jitter (${preference})`, () => {
    for (const composite of [false, true]) {
      it(`moves the drawn image by physical pixels, right and down, ${composite ? 'composited' : 'direct'}`, async () => {
        const size = 32;
        const resolution = 2;
        const physical = size * resolution;
        const app = await getApp<Renderer>({
          id: `camera-jitter-${composite ? 'composite' : 'direct'}-${preference}`,
          appOptions: { preference, width: size, height: size, resolution, backgroundColor: 0x000000 },
        });
        const view3d = new View3D({ width: size, height: size, composite });

        try {
          expect(app.renderer.name).toBe(preference);
          app.stage.addChild(view3d);

          const camera = view3d.camera;
          camera.useOrthographic(10, 0.1, 100);
          camera.position.set(0, 0, 10);

          const quad = new Mesh3D({
            geometry: new PlaneGeometry({ width: 20, height: 20 }),
            material: new FlatMaterial({ doubleSided: true }),
          });
          quad.position.set(-10, 10, 0);
          view3d.root.addChild(quad);

          const still = coverage(await renderFrame(app), physical);
          expect(still).toEqual({ columns: physical / 2, rows: physical / 2 });
          const built = Float32Array.from(camera.projection.elements);

          camera.jitter.set(1, 2);
          const moved = coverage(await renderFrame(app), physical);
          expect(moved).toEqual({ columns: physical / 2 + 1, rows: physical / 2 + 2 });

          expect(camera.projection.elements, "the camera's own projection stays as built").toEqual(built);
          expect(getCameraData(camera).projection.elements).not.toEqual(built);

          camera.jitter.set(0, 0);
          expect(coverage(await renderFrame(app), physical)).toEqual(still);
        } finally {
          view3d.destroy(true);
          app.destroy();
        }
      });
    }

    it('moves the image by scene pixels when View3D.resolution draws the scene at half size', async () => {
      const size = 32;
      const physical = size * 2;
      const app = await getApp<Renderer>({
        id: `camera-jitter-half-${preference}`,
        appOptions: { preference, width: size, height: size, resolution: 2, backgroundColor: 0x000000 },
      });
      const view3d = new View3D({ width: size, height: size, resolution: 1 });

      try {
        app.stage.addChild(view3d);
        view3d.camera.useOrthographic(10, 0.1, 100);
        view3d.camera.position.set(0, 0, 10);

        const quad = new Mesh3D({
          geometry: new PlaneGeometry({ width: 20, height: 20 }),
          material: new FlatMaterial({ doubleSided: true }),
        });
        quad.position.set(-10, 10, 0);
        view3d.root.addChild(quad);

        expect(
          coverage(await renderFrame(app), physical),
          "the blit stretches each scene pixel over two, and the quad's edge still lands at the centre",
        ).toEqual({ columns: physical / 2, rows: physical / 2 });

        view3d.camera.jitter.set(1, 2);
        expect(coverage(await renderFrame(app), physical), 'one scene pixel is two on screen').toEqual({
          columns: physical / 2 + 2,
          rows: physical / 2 + 4,
        });
      } finally {
        view3d.destroy(true);
        app.destroy();
      }
    });
  });
}
