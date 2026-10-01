import { getApp, readCanvasPixels } from '@test-utils';
import type { Application, Renderer, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { MATERIAL_STRIDE_FLOATS } from '~/core/buffers/MaterialDataStoreBuffer';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { Skeleton } from '~/scene/Skeleton';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

/** Off-screen meshes sharing the pass, so it holds more instances than the two on screen */
const FILLER_INSTANCES = 40;

/** Enough more instances to push the WebGL index texture past its 256-instance starting capacity */
const INDEX_TEXTURE_GROWTH = 300;

/**
 * Renders one frame and returns the canvas as that frame drew it, failing the test if WebGPU
 * raised a validation error. It reads the canvas before it awaits anything, so the pixels are
 * the tested frame's and never a later one's.
 */
async function renderFrame(app: Application<Renderer>): Promise<Uint8ClampedArray> {
  const device = (app.renderer as WebGPURenderer).gpu?.device;

  device?.pushErrorScope('validation');
  app.render();
  const pixels = readCanvasPixels(app.canvas);
  const error = await device?.popErrorScope();

  expect(error?.message ?? null).toBe(null);

  return pixels;
}

/** RGB of the canvas pixel at `(x, y)` */
function rgbAt(pixels: Uint8ClampedArray, canvasWidth: number, x: number, y: number): number[] {
  const i = (y * canvasWidth + x) * 4;

  return [pixels[i], pixels[i + 1], pixels[i + 2]];
}

/** A camera-facing skinned quad whose `jointCount` joints all sit at the origin */
function skinnedQuad(jointCount: number, color: number): Mesh3D {
  const geometry = new Geometry3D({
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    joints: new Uint8Array(16),
    weights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  });
  const inverseBindMatrices = new Float32Array(jointCount * 16);
  for (let i = 0; i < jointCount; i++) {
    inverseBindMatrices.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], i * 16);
  }

  return new Mesh3D({
    geometry,
    material: new FlatMaterial({ baseColor: color }),
    skeleton: new Skeleton({
      parent: new Int16Array(jointCount).fill(-1),
      joints: new Int16Array(jointCount).map((_, i) => i),
      inverseBindMatrices,
    }),
  });
}

/**
 * Adds `count` off-screen meshes, each with its own geometry and material
 *
 * Past 100 meshes the mesh, material and geometry stores grow.
 */
function addOffscreen(view3d: View3D, count: number): void {
  for (let i = 0; i < count; i++) {
    const mesh = new Mesh3D({
      geometry: new CubeGeometry({ width: 0.1, height: 0.1, depth: 0.1 }),
      material: new FlatMaterial({ baseColor: 0xffffff }),
    });
    mesh.position.set(0, 500, 0);
    view3d.root.addChild(mesh);
  }
}

/** A red cube left of centre (pixel x 21) and a blue one right of it (pixel x 43), with their materials */
function twoCubes(view3d: View3D): { left: FlatMaterial; right: FlatMaterial } {
  const geometry = new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 });
  const left = new FlatMaterial({ baseColor: 0xff0000 });
  const right = new FlatMaterial({ baseColor: 0x0000ff });
  const a = new Mesh3D({ geometry, material: left });
  const b = new Mesh3D({ geometry, material: right });
  a.position.set(-1.2, 0, 0);
  b.position.set(1.2, 0, 0);
  view3d.root.addChild(a, b);
  view3d.camera.position.set(0, 0, 6);

  return { left, right };
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`store uploads reach the GPU (${preference})`, () => {
    const appOptions = { preference, width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x000000 };

    it('a material changed after the first frame reaches the GPU, and its neighbour keeps its row', async () => {
      const app = await getApp({ id: `store-upload-material-${preference}`, appOptions });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE });
        app.stage.addChild(view3d);
        const { right } = twoCubes(view3d);

        let pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 0, 255]);

        right.baseColor = 0x00ff00;
        pixels = await renderFrame(app);

        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 255, 0]);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('growth after the first frame keeps old rows and takes new writes', async () => {
      const app = await getApp({ id: `store-upload-growth-${preference}`, appOptions });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE });
        app.stage.addChild(view3d);
        const { right } = twoCubes(view3d);

        let pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 0, 255]);

        const meshVersion = view3d._sceneBatch.storeBuffer.bufferVersion;
        addOffscreen(view3d, 150);
        right.baseColor = 0x00ff00;
        pixels = await renderFrame(app);

        expect(view3d._sceneBatch.storeBuffer.bufferVersion).toBeGreaterThan(meshVersion);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 255, 0]);

        right.baseColor = 0xffff00;
        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32), 'a later partial write lands in the grown resource').toEqual([255, 255, 0]);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('a change and growth made after an unload reach the GPU on the next frame', async () => {
      const app = await getApp({ id: `store-upload-unload-${preference}`, appOptions });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE });
        app.stage.addChild(view3d);
        const { right } = twoCubes(view3d);
        await renderFrame(app);

        view3d.unload();
        right.baseColor = 0x00ff00;
        let pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 255, 0]);

        view3d.unload();
        addOffscreen(view3d, 150);
        right.baseColor = 0xffff00;
        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([255, 255, 0]);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('a second view growing the shared stores mid-frame leaves the first view intact', async () => {
      const app = await getApp({
        id: `store-upload-shared-${preference}`,
        appOptions: { ...appOptions, width: SIZE * 2 },
      });

      try {
        const viewA = new View3D({ width: SIZE, height: SIZE });
        const viewB = new View3D({ width: SIZE, height: SIZE });
        viewB.x = SIZE;
        app.stage.addChild(viewA, viewB);
        const a = twoCubes(viewA);
        const b = twoCubes(viewB);

        await renderFrame(app);

        addOffscreen(viewB, 150);
        a.right.baseColor = 0x00ff00;
        b.right.baseColor = 0xff00ff;
        const pixels = await renderFrame(app);

        expect(rgbAt(pixels, SIZE * 2, 21, 32)).toEqual([255, 0, 0]);
        expect(
          rgbAt(pixels, SIZE * 2, 43, 32),
          "B grows the shared stores after A has drawn, and A's change still lands",
        ).toEqual([0, 255, 0]);
        expect(rgbAt(pixels, SIZE * 2, 21 + SIZE, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE * 2, 43 + SIZE, 32)).toEqual([255, 0, 255]);

        viewA.destroy({ children: true });
        viewB.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('bone pit growth inside add() still uploads every bone', async () => {
      const app = await getApp({ id: `store-upload-bones-${preference}`, appOptions });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE });
        app.stage.addChild(view3d);
        const first = skinnedQuad(2, 0xff0000);
        first.position.set(-1.2, 0, 0);
        view3d.root.addChild(first);
        view3d.camera.position.set(0, 0, 6);

        let pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);

        /** 300 joints push the pit past its 256-bone starting capacity, inside `add()` */
        const second = skinnedQuad(300, 0x0000ff);
        second.position.set(1.2, 0, 0);
        view3d.root.addChild(second);
        const version = view3d._bonePit.bufferVersion;
        pixels = await renderFrame(app);

        expect(view3d._bonePit.bufferVersion).toBeGreaterThan(version);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 0, 255]);

        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 0, 255]);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });

    it('instances hidden, shown or moved after the first frame draw in the right place', async () => {
      const app = await getApp({ id: `store-upload-instances-${preference}`, appOptions });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE, cull: 'cpu' });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 6);

        const geometry = new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 });
        const material = new FlatMaterial({ baseColor: 0xff0000 });
        const left = new Mesh3D({ geometry, material });
        const right = new Mesh3D({ geometry, material });
        left.position.set(-1.2, 0, 0);
        right.position.set(1.2, 0, 0);
        view3d.root.addChild(left, right);
        for (let i = 0; i < FILLER_INSTANCES; i++) {
          const mesh = new Mesh3D({ geometry, material });
          mesh.position.set(0, 500, 0);
          view3d.root.addChild(mesh);
        }

        let pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([255, 0, 0]);

        left.visible = false;
        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([0, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([255, 0, 0]);

        left.visible = true;
        right.visible = false;
        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 0, 0]);

        right.visible = true;
        left.position.set(0, 500, 0);
        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([0, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([255, 0, 0]);

        for (let i = 0; i < INDEX_TEXTURE_GROWTH; i++) {
          const mesh = new Mesh3D({ geometry, material });
          mesh.position.set(0, 500, 0);
          view3d.root.addChild(mesh);
        }
        left.position.set(-1.2, 0, 0);
        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([255, 0, 0]);

        right.visible = false;
        pixels = await renderFrame(app);
        expect(rgbAt(pixels, SIZE, 21, 32)).toEqual([255, 0, 0]);
        expect(rgbAt(pixels, SIZE, 43, 32)).toEqual([0, 0, 0]);

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });
  });
}

describe('store uploads are partial (webgl)', () => {
  it('a one-material change uploads one material row of texels', async () => {
    const app = await getApp<WebGLRenderer>({
      id: 'store-upload-gl-rect',
      appOptions: { preference: 'webgl', width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x000000 },
    });

    try {
      const view3d = new View3D({ width: SIZE, height: SIZE });
      app.stage.addChild(view3d);
      const { right } = twoCubes(view3d);
      app.render();

      const gl = app.renderer.gl;
      const sub = vi.spyOn(gl, 'texSubImage2D');
      const full = vi.spyOn(gl, 'texImage2D');

      right.baseColor = 0x00ff00;
      app.render();

      /** Sizes of the uploads to `rgba32uint` textures, which only the mesh, geometry and material stores use */
      const sizes = sub.mock.calls.filter((call) => call[6] === gl.RGBA_INTEGER).map((call) => [call[4], call[5]]);
      const wholeTexels = app.renderer.renderPipes.view3d.materialStoreBuffer.data.length / 4;
      const rowTexels = MATERIAL_STRIDE_FLOATS / 4;

      expect(sizes.some(([width, height]) => width === rowTexels && height === 1)).toBe(true);
      expect(sizes.some(([width]) => width === wholeTexels)).toBe(false);
      expect(full).not.toHaveBeenCalled();

      view3d.destroy({ children: true });
    } finally {
      app.destroy();
    }
  });
});
