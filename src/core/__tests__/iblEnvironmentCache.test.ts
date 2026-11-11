import { captureWarnings, encoded, expectCleanRender, getApp, readCanvasPixels } from '@test-utils';
import { BufferImageSource, CubeTexture, Texture } from 'pixi.js';
import type { Application, Renderer, TextureSource, WebGLRenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { ColorCubeTexture } from '~/core/textures/ColorCubeTexture';
import { CUBETEXTURE_EMPTY } from '~/core/textures/DefaultTextures';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

function prefilteredCubes(app: Application<Renderer>): Map<TextureSource, CubeTexture> {
  const pipes = app.renderer.renderPipes as unknown as Record<
    string,
    { _iblEnvironmentMap: Map<TextureSource, CubeTexture> }
  >;
  return pipes.view3d._iblEnvironmentMap;
}

function gpuCopies(source: TextureSource): number {
  const gpuData = source._gpuData as Record<number, unknown>;
  let n = 0;
  for (const uid in gpuData) if (gpuData[uid]) n++;
  return n;
}

function centreRgb(app: Application<Renderer>): number[] {
  const [r, g, b] = readCanvasPixels(app.canvas, SIZE / 2, SIZE / 2, 1, 1);
  return [r, g, b];
}

function paintedCube(size: number): CubeTexture {
  const resource = new Uint8Array(size * size * 4).fill(128);
  const face = (): Texture =>
    new Texture({ source: new BufferImageSource({ resource, format: 'rgba8unorm', width: size, height: size }) });
  return CubeTexture.from({
    faces: { right: face(), left: face(), top: face(), bottom: face(), front: face(), back: face() },
  });
}

const HALF_TWO = 0x4000;
const HALF_ONE = 0x3c00;

function brightFloatCube(): CubeTexture {
  const size = 16;
  const resource = new Uint16Array(size * size * 4);
  for (let i = 0; i < resource.length; i += 4) resource.set([HALF_TWO, HALF_TWO, HALF_TWO, HALF_ONE], i);
  const face = (): Texture =>
    new Texture({ source: new BufferImageSource({ resource, format: 'rgba16float', width: size, height: size }) });
  return CubeTexture.from({
    faces: { right: face(), left: face(), top: face(), bottom: face(), front: face(), back: face() },
  });
}

function buildMirror(app: Application<Renderer>): View3D {
  const view3d = new View3D({ width: SIZE, height: SIZE, toneMapping: 'none' });
  app.stage.addChild(view3d);
  view3d.root.addChild(
    new Mesh3D({
      geometry: new SphereGeometry({ radius: 1 }),
      material: new Material3D({ baseColor: 0xffffff, metallic: 1, roughness: 0 }),
      castShadow: false,
      receiveShadow: false,
    }),
  );
  view3d.camera.position.set(0, 0, 3);
  return view3d;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`prefiltered environment cubes (${preference})`, () => {
    const environmentSlot = preference === 'webgpu' ? 2 : 1;

    async function withMirror(
      id: string,
      run: (app: Application<Renderer>, view3d: View3D, slot: () => unknown) => Promise<void>,
    ): Promise<void> {
      const app = await getApp<Renderer>({
        id: `${id}-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x000000 },
      });
      const view3d = buildMirror(app);
      const slot = (): unknown => view3d._gpuData[app.renderer.uid].globalBindGroup.getResource(environmentSlot);
      try {
        await run(app, view3d, slot);
      } finally {
        view3d.destroy({ children: true, geometry: true, material: true });
        app.destroy();
      }
    }

    it('lights with the new cube after a swap to another cube', async () => {
      await withMirror('ibl-cube-swap', async (app, view3d) => {
        const red = ColorCubeTexture.from(0xff0000);
        const blue = ColorCubeTexture.from(0x0000ff);

        view3d.environment = red;
        app.render();
        const [r0, , b0] = centreRgb(app);
        expect(r0).toBeGreaterThan(b0 + 64);

        view3d.environment = blue;
        app.render();
        const [r1, , b1] = centreRgb(app);
        expect(
          b1,
          'the recorded opaque draws sample the new cube, not the one they were recorded with',
        ).toBeGreaterThan(r1 + 64);

        view3d.environment = null;
        red.destroy(true);
        blue.destroy(true);
      });
    });

    it('frees the prefiltered cube when its environment is destroyed', async () => {
      await withMirror('ibl-cube-release', async (app, view3d, slot) => {
        const red = ColorCubeTexture.from(0xff0000);
        const blue = ColorCubeTexture.from(0x0000ff);
        const cubes = prefilteredCubes(app);

        view3d.environment = red;
        app.render();
        const redCube = cubes.get(red.source)!.source;
        view3d.environment = blue;
        app.render();
        const blueCube = cubes.get(blue.source)!.source;
        expect(gpuCopies(redCube)).toBe(1);

        const onRedDestroy = captureWarnings(() => red.destroy(true));
        expect(onRedDestroy.filter((text) => text.includes('[BindGroup]'))).toEqual([]);
        expect(gpuCopies(redCube), "the destroyed environment's cube gave its GPU memory back").toBe(0);
        expect([...cubes.keys()]).toEqual([blue.source]);

        const onBlueDestroy = captureWarnings(() => blue.destroy(true));
        expect(
          onBlueDestroy.filter((text) => text.includes('[BindGroup]')),
          'the view still binds the cube; unloading it under the bind group is silent',
        ).toEqual([]);
        expect(gpuCopies(blueCube)).toBe(0);
        expect(cubes.size).toBe(0);

        await expectCleanRender(app);
        expect(slot()).toBe(CUBETEXTURE_EMPTY.source);
        expect(gpuCopies(blueCube), 'the next frame rebinds the slot rather than reviving the cube').toBe(0);
        view3d.environment = null;
      });
    });

    it('binds the empty cube once the view has no cube environment', async () => {
      await withMirror('ibl-cube-unbind', async (app, view3d, slot) => {
        const red = ColorCubeTexture.from(0xff0000);

        view3d.environment = red;
        app.render();
        expect(slot()).toBe(prefilteredCubes(app).get(red.source)!.source);

        view3d.environment = null;
        await expectCleanRender(app);
        expect(slot()).toBe(CUBETEXTURE_EMPTY.source);

        view3d.environment = red;
        await expectCleanRender(app);
        view3d.environment = { skyColor: 0xffffff, groundColor: 0x000000 };
        await expectCleanRender(app);
        expect(slot()).toBe(CUBETEXTURE_EMPTY.source);

        red.destroy(true);
      });
    });

    it('sizes the prefiltered cube to its source, between 128 and 256 texels', async () => {
      await withMirror('ibl-cube-size', async (app, view3d) => {
        const small = ColorCubeTexture.from(0xff0000);
        const large = paintedCube(512);
        const cubes = prefilteredCubes(app);

        view3d.environment = small;
        app.render();
        view3d.environment = large;
        app.render();
        const smallCube = cubes.get(small.source)!.source;
        const largeCube = cubes.get(large.source)!.source;

        expect([smallCube.pixelWidth, smallCube.mipLevelCount]).toEqual([128, 5]);
        expect([largeCube.pixelWidth, largeCube.mipLevelCount]).toEqual([256, 5]);

        view3d.environment = null;
        small.destroy(true);
        large.destroy(true);
      });
    });

    it('keeps a float environment linear and above 1, in reflections and the sky', async () => {
      await withMirror('ibl-cube-hdr', async (app, view3d) => {
        const eightBit = ColorCubeTexture.from(0x808080);
        view3d.background = eightBit;
        app.render();

        const bright = brightFloatCube();
        view3d.environment = bright;
        view3d.background = bright;
        view3d.exposure = 0.25;
        app.render();

        const expected = encoded(2 * 0.25);
        const [skyR] = readCanvasPixels(app.canvas, 1, 1, 1, 1);
        expect(skyR, 'the sky shows radiance 2, not 1 (clamped) or 2^2.2 (decoded twice)').toBeCloseTo(expected, -1);
        const [mirrorR] = centreRgb(app);
        expect(mirrorR, 'the mirror reflects radiance 2 through the prefiltered cube').toBeGreaterThan(expected - 12);
        expect(mirrorR).toBeLessThan(expected + 6);

        view3d.environment = null;
        view3d.background = 0x000000;
        app.render();
        bright.destroy(true);
        eightBit.destroy(true);
      });
    });

    it.runIf(preference === 'webgl')('names EXT_color_buffer_float when the device lacks it', async () => {
      await withMirror('ibl-cube-no-float', async (app, view3d) => {
        const extensions = (app.renderer as WebGLRenderer).context.extensions;
        const colorBufferFloat = extensions.colorBufferFloat;
        const red = ColorCubeTexture.from(0xff0000);
        extensions.colorBufferFloat = undefined;
        try {
          view3d.environment = red;
          expect(() => app.render()).toThrow(/EXT_color_buffer_float/);
        } finally {
          extensions.colorBufferFloat = colorBufferFloat;
          view3d.environment = null;
          red.destroy(true);
        }
      });
    });

    it('stops listening to a live environment when the renderer is destroyed', async () => {
      const red = ColorCubeTexture.from(0xff0000);
      let onDestroy: unknown;
      let cube: TextureSource | undefined;
      await withMirror('ibl-cube-teardown', async (app, view3d) => {
        view3d.environment = red;
        app.render();
        onDestroy = (app.renderer.renderPipes as unknown as Record<string, { _onEnvironmentDestroy: unknown }>).view3d
          ._onEnvironmentDestroy;
        cube = prefilteredCubes(app).get(red.source)!.source;
        expect(red.source.listeners('destroy')).toContain(onDestroy);
      });
      expect(red.source.listeners('destroy')).not.toContain(onDestroy);
      expect(cube!.destroyed).toBe(true);
      red.destroy(true);
    });
  });
}
