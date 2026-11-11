import { getApp, renderFrame } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { dissolveBit } from '~/extras/materials/bits/dissolveBit';
import { Geometry3D } from '~/geometry/Geometry3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { Skeleton } from '~/scene/Skeleton';
import { View3D } from '~/scene/View3D';

const SIZE = 64;
const BACKENDS = ['webgl', 'webgpu'] as const;
const SHIFT_X = 0.3;

const nothingDrewAt = (pixels: Uint8ClampedArray, byte: number) =>
  pixels[byte] <= 2 && pixels[byte + 1] >= 253 && pixels[byte + 2] <= 2;

function greenBackgroundPixels(pixels: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) if (nothingDrewAt(pixels, i)) count++;

  return count;
}

function maxChannelDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));

  return max;
}

async function withGreyPlaneFillingGreenCanvas(
  preference: (typeof BACKENDS)[number],
  check: (
    renderPlainOrWithBit: (dissolve?: number, edgeColor?: number[], holeSize?: number) => Promise<Uint8ClampedArray>,
  ) => Promise<void>,
  { storedSize = 4, nodeScale = 1 }: { storedSize?: number; nodeScale?: number } = {},
): Promise<void> {
  const app = await getApp<Renderer>({
    id: `dissolve-bit-${preference}`,
    appOptions: { preference, width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x00ff00 },
  });
  const view3d = new View3D({ width: SIZE, height: SIZE, toneMapping: 'none' });
  const plain = new Material3D({ baseColor: 0x202020 });
  const made = [plain];

  try {
    const mesh = new Mesh3D({
      geometry: new PlaneGeometry({ width: storedSize, height: storedSize }),
      material: plain,
    });

    mesh.scale.set(nodeScale);
    app.stage.addChild(view3d);
    view3d.root.addChild(mesh);
    view3d.camera.position.set(0, 0, 2);

    await check(async (dissolve, edgeColor, holeSize) => {
      if (dissolve === undefined) {
        mesh.material = plain;
      } else {
        const copy = plain.clone({ extraBits: [dissolveBit] });
        made.push(copy);
        copy.data.dissolve = dissolve;
        if (edgeColor) copy.data.dissolveEdgeColor = edgeColor;
        if (holeSize !== undefined) copy.data.dissolveHoleSize = holeSize;
        mesh.material = copy;
      }

      return renderFrame(app);
    });
  } finally {
    view3d.destroy({ children: true, geometry: true, material: true });
    app.destroy(true);
    for (const material of made) material.destroy();
  }
}

const quadFacingCamera = () => ({
  positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
  indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
});

const DEFORMERS: Record<
  string,
  (material: Material3D) => { mesh: Mesh3D; shiftXWithoutTransform: () => void; destroyNotOwnedByMesh?: () => void }
> = {
  'a bone': (material) => {
    const skeleton = new Skeleton({
      parent: new Int16Array([-1]),
      joints: new Int16Array([0]),
      inverseBindMatrices: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    });
    const geometry = new Geometry3D({
      ...quadFacingCamera(),
      joints: new Uint8Array(16),
      weights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    });

    return {
      mesh: new Mesh3D({ geometry, material, skeleton }),
      shiftXWithoutTransform: () => skeleton.setLocalTRS(0, SHIFT_X, 0, 0, 0, 0, 0, 1),
      destroyNotOwnedByMesh: () => skeleton.destroy(),
    };
  },
  'a morph target': (material) => {
    const geometry = new Geometry3D({
      ...quadFacingCamera(),
      morphTargets: [{ positions: new Float32Array([SHIFT_X, 0, 0, SHIFT_X, 0, 0, SHIFT_X, 0, 0, SHIFT_X, 0, 0]) }],
    });
    const mesh = new Mesh3D({ geometry, material, weights: new Float32Array([0]) });

    return {
      mesh,
      shiftXWithoutTransform: () => {
        mesh.weights![0] = 1;
      },
    };
  },
};

describe('dissolveBit', () => {
  it.each(BACKENDS)('draws the surface as it was at dissolve 0 on %s', async (preference) => {
    await withGreyPlaneFillingGreenCanvas(preference, async (render) => {
      const plain = await render();
      const withBit = await render(0, [6, 0, 0]);

      expect(greenBackgroundPixels(plain)).toBe(0);
      expect(maxChannelDiff(plain, withBit)).toBeLessThanOrEqual(1);
    });
  });

  it.each(BACKENDS)('cuts all of the surface away at 1 on %s', async (preference) => {
    await withGreyPlaneFillingGreenCanvas(preference, async (render) => {
      expect(greenBackgroundPixels(await render(1))).toBe(SIZE * SIZE);
    });
  });

  it.each(BACKENDS)(
    'cuts the same holes on a mesh stored 100 times larger when its hole size is 100 times larger on %s',
    async (preference) => {
      let normal: Uint8ClampedArray = new Uint8ClampedArray();

      await withGreyPlaneFillingGreenCanvas(preference, async (render) => {
        normal = await render(0.5, [6, 0, 0]);
      });
      await withGreyPlaneFillingGreenCanvas(
        preference,
        async (render) => {
          const sized = await render(0.5, [6, 0, 0], 25);
          const unsized = await render(0.5, [6, 0, 0]);

          expect(maxChannelDiff(sized, normal)).toBeLessThanOrEqual(1);
          expect(maxChannelDiff(unsized, normal)).toBeGreaterThan(1);
        },
        { storedSize: 400, nodeScale: 0.01 },
      );
    },
  );

  it.each(BACKENDS.flatMap((preference) => Object.keys(DEFORMERS).map((by) => [by, preference] as const)))(
    'keeps the holes on the surface when %s moves the mesh on %s',
    async (by, preference) => {
      const app = await getApp<Renderer>({
        id: `dissolve-bit-deform-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x00ff00 },
      });
      const view3d = new View3D({ width: SIZE, height: SIZE, toneMapping: 'none' });
      const plain = new Material3D({ baseColor: 0x202020 });
      const copy = plain.clone({ extraBits: [dissolveBit] });
      const { mesh, shiftXWithoutTransform, destroyNotOwnedByMesh } = DEFORMERS[by](copy);

      try {
        app.stage.addChild(view3d);
        view3d.root.addChild(mesh);
        view3d.camera.position.set(0, 0, 3);

        mesh.position.x = SHIFT_X;
        const whole = await renderFrame(app);

        copy.data.dissolve = 0.5;
        const movedByTransform = await renderFrame(app);

        mesh.position.x = 0;
        shiftXWithoutTransform();
        const movedByDeformer = await renderFrame(app);

        expect(greenBackgroundPixels(movedByDeformer)).toBeGreaterThan(greenBackgroundPixels(whole));
        expect(greenBackgroundPixels(movedByDeformer)).toBeLessThan(SIZE * SIZE);
        expect(maxChannelDiff(movedByTransform, movedByDeformer)).toBeLessThanOrEqual(1);
      } finally {
        view3d.destroy({ children: true, geometry: true, material: true });
        app.destroy(true);
        plain.destroy();
        copy.destroy();
        destroyNotOwnedByMesh?.();
      }
    },
  );
});
