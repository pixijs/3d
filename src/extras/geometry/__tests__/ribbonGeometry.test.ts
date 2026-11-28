import { getApp, renderFrame } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RibbonGeometry } from '~/extras/geometry/RibbonGeometry';
import type { RibbonGeometryOptions } from '~/extras/geometry/RibbonGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import type { CameraMode } from '~/scene/cameras/Camera3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;
const BACKENDS = ['webgl', 'webgpu'] as const;
const MODES: CameraMode[] = ['perspective', 'orthographic'];

function straightLineAlongXAtDepth(z: number, fromX = -40, toX = 40): number[] {
  const points: number[] = [];
  for (let i = 0; i <= 8; i++) points.push(fromX + ((toX - fromX) * i) / 8, 0, z);
  return points;
}

function whiteRowsInColumn(pixels: Uint8ClampedArray, width: number, column: number): number {
  let rows = 0;
  for (let y = 0; y < pixels.length / 4 / width; y++) {
    if (pixels[(y * width + column) * 4] > 128) rows++;
  }
  return rows;
}

async function render(
  preference: (typeof BACKENDS)[number],
  mode: CameraMode,
  meshes: Mesh3D[],
  resolution = 1,
  betweenFrames?: () => void,
): Promise<Uint8ClampedArray> {
  const app = await getApp<Renderer>({
    id: `ribbon-${preference}`,
    appOptions: { preference, width: SIZE, height: SIZE, resolution, backgroundColor: 0x000000 },
  });
  try {
    const view3d = new View3D({ width: SIZE, height: SIZE, toneMapping: 'none' });
    app.stage.addChild(view3d);
    for (const mesh of meshes) view3d.root.addChild(mesh);
    view3d.camera.mode = mode;
    view3d.camera.fov = 60;
    view3d.camera.orthographicSize = 4;
    view3d.camera.position.set(0, 0, 5);
    if (betweenFrames) {
      await renderFrame(app);
      betweenFrames();
    }

    return await renderFrame(app);
  } finally {
    app.destroy(true, { children: true });
  }
}

function white(geometry: RibbonGeometry | PlaneGeometry): Mesh3D {
  return new Mesh3D({ geometry, material: new FlatMaterial({ baseColor: 0xffffff }) });
}

describe('RibbonGeometry', () => {
  it('builds two vertices for each point and two triangles for each segment of each line', () => {
    const points = straightLineAlongXAtDepth(0).slice(0, 6 * 3);
    const lists = new RibbonGeometry({ points, pointsPerLine: [4, 2] });
    const pairs = new RibbonGeometry({ points, pointsPerLine: 2 });

    expect(lists.vertexCount).toBe(12);
    expect(lists.indices.length, 'three segments, then one').toBe(4 * 6);
    expect(pairs.indices.length, 'three lines of one segment each').toBe(3 * 6);
  });

  it('pads world bounds by half the widest width, and pixel bounds not at all', () => {
    const points = [0, 0, 0, 2, 1, 0];
    const world = new RibbonGeometry({ points, width: [0.2, 0.6] });
    const pixels = new RibbonGeometry({ points, width: 10, widthUnits: 'pixels' });

    expect(world.bounds3D.min.toArray()).toEqual([-0.3, -0.3, -0.3].map((v) => expect.closeTo(v, 6)));
    expect(world.bounds3D.max.toArray()).toEqual([2.3, 1.3, 0.3].map((v) => expect.closeTo(v, 6)));
    expect(pixels.bounds3D.min.toArray()).toEqual([0, 0, 0]);
    expect(pixels.bounds3D.max.toArray()).toEqual([2, 1, 0]);
  });

  it('puts the distance along the line in u, and 0 then 1 across it in v', () => {
    const ribbon = new RibbonGeometry({ points: [0, 0, 0, 3, 4, 0, 3, 4, 2] });

    expect(Array.from(ribbon.uvs!)).toEqual([0, 0, 0, 1, 5, 0, 5, 1, 7, 0, 7, 1]);
  });

  it("gives each point's colour and own attributes to both of its vertices", () => {
    const options: RibbonGeometryOptions = {
      points: [0, 0, 0, 1, 0, 0],
      colors: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]),
      pointAttributes: { aGlow: new Float32Array([0.25, 0.75]), aWind: new Float32Array([1, 2, 3, 4]) },
    };
    const ribbon = new RibbonGeometry(options);
    const { aColor, aGlow, aWind } = ribbon.attributes;

    expect(Array.from(aColor.buffer.data)).toEqual([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 128, 0, 0, 255, 128]);
    expect(aGlow.format).toBe('float32');
    expect(Array.from(aGlow.buffer.data)).toEqual([0.25, 0.25, 0.75, 0.75]);
    expect(aWind.format).toBe('float32x2');
    expect(Array.from(aWind.buffer.data)).toEqual([1, 2, 1, 2, 3, 4, 3, 4]);
  });

  it("keeps a triangle list in buffers of its own, whatever Geometry3D's defaults say", () => {
    const { interleave, topology } = Geometry3D.defaultOptions;
    Geometry3D.defaultOptions.interleave = true;
    Geometry3D.defaultOptions.topology = 'line-list';
    try {
      const ribbon = new RibbonGeometry({ points: [0, 0, 0, 1, 0, 0] });

      expect(ribbon.topology).toBe('triangle-list');
      expect(ribbon.attributes.aPosition.buffer).not.toBe(ribbon.attributes.aUV.buffer);
    } finally {
      Geometry3D.defaultOptions.interleave = interleave;
      Geometry3D.defaultOptions.topology = topology;
    }
  });

  it('setPoints moves the strip and its distances along the line', () => {
    const ribbon = new RibbonGeometry({ points: [0, 0, 0, 1, 0, 0], width: 0, dynamic: true });

    ribbon.setPoints([0, 2, 0, 0, 5, 0]);

    expect(Array.from(ribbon.positions)).toEqual([0, 2, 0, 0, 2, 0, 0, 5, 0, 0, 5, 0]);
    expect(Array.from(ribbon.uvs!)).toEqual([0, 0, 0, 1, 3, 0, 3, 1]);
  });

  describe.each(BACKENDS)('on %s', (preference) => {
    describe.each(MODES)('through a %s camera', (mode) => {
      it.each([0, -20])('draws a pixel width as that many pixels with the line at depth %d', async (z) => {
        const ribbon = white(
          new RibbonGeometry({ points: straightLineAlongXAtDepth(z), width: 10, widthUnits: 'pixels' }),
        );
        const pixels = await render(preference, mode, [ribbon]);

        expect(Math.abs(whiteRowsInColumn(pixels, SIZE, SIZE / 2) - 10)).toBeLessThanOrEqual(1);
      });

      it('draws a world width as tall as a plane that wide beside it', async () => {
        const plane = white(new PlaneGeometry({ width: 1, height: 1 }));
        plane.position.x = -1.5;
        const ribbon = white(new RibbonGeometry({ points: straightLineAlongXAtDepth(0, 0.5, 2.5), width: 1 }));
        const pixels = await render(preference, mode, [plane, ribbon]);
        const planeRows = whiteRowsInColumn(pixels, SIZE, Math.round(SIZE * 0.27));
        const ribbonRows = whiteRowsInColumn(pixels, SIZE, Math.round(SIZE * 0.73));

        expect(planeRows, 'the plane shows').toBeGreaterThan(4);
        expect(Math.abs(ribbonRows - planeRows)).toBeLessThanOrEqual(1);
      });
    });

    it('draws a dynamic ribbon where setPoints moves it, from off screen into view', async () => {
      const geometry = new RibbonGeometry({
        points: straightLineAlongXAtDepth(0, 20, 30),
        width: 10,
        widthUnits: 'pixels',
        dynamic: true,
      });
      const pixels = await render(preference, 'perspective', [white(geometry)], 1, () =>
        geometry.setPoints(straightLineAlongXAtDepth(0)),
      );

      expect(Math.abs(whiteRowsInColumn(pixels, SIZE, SIZE / 2) - 10)).toBeLessThanOrEqual(1);
    });

    it('draws a dynamic ribbon in the direction setPoints turns it to', async () => {
      const geometry = new RibbonGeometry({
        points: straightLineAlongXAtDepth(0),
        width: 10,
        widthUnits: 'pixels',
        dynamic: true,
      });
      const alongY = straightLineAlongXAtDepth(0).map((_, i, points) =>
        i % 3 === 0 ? points[i + 1] : i % 3 === 1 ? points[i - 1] : 0,
      );
      const pixels = await render(preference, 'perspective', [white(geometry)], 1, () => geometry.setPoints(alongY));
      const row = SIZE / 2;
      let columns = 0;
      for (let x = 0; x < SIZE; x++) if (pixels[(row * SIZE + x) * 4] > 128) columns++;

      expect(Math.abs(columns - 10), 'columns the vertical ribbon covers').toBeLessThanOrEqual(1);
    });

    it('keeps drawing a pixel ribbon whose points are off screen while its edge is on it', async () => {
      const justPastRightEdge = [3.5, -0.3, 0, 3.5, 0.3, 0];
      const ribbon = white(new RibbonGeometry({ points: justPastRightEdge, width: 24, widthUnits: 'pixels' }));
      const pixels = await render(preference, 'perspective', [ribbon]);
      const row = SIZE / 2;

      expect(pixels[(row * SIZE + SIZE - 1) * 4], 'the right-hand column shows the ribbon').toBeGreaterThan(128);
    });

    it.each([2, 0.25])('scales a world width with the mesh, at scale %d', async (scale) => {
      const ribbon = white(new RibbonGeometry({ points: straightLineAlongXAtDepth(0), width: 1 }));
      ribbon.scale.set(scale, scale, scale);
      const pixels = await render(preference, 'orthographic', [ribbon]);
      const pixelsPerUnit = SIZE / 8;

      expect(Math.abs(whiteRowsInColumn(pixels, SIZE, SIZE / 2) - scale * pixelsPerUnit)).toBeLessThanOrEqual(1);
    });

    it('measures a pixel width in pixels before the resolution', async () => {
      const ribbon = white(
        new RibbonGeometry({ points: straightLineAlongXAtDepth(0), width: 10, widthUnits: 'pixels' }),
      );
      const pixels = await render(preference, 'perspective', [ribbon], 2);

      expect(Math.abs(whiteRowsInColumn(pixels, SIZE * 2, SIZE) - 20)).toBeLessThanOrEqual(1);
    });
  });
});
