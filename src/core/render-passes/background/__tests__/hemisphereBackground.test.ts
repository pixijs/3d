import { captureWarnings, expectCleanRender, getApp, readCanvasPixels } from '@test-utils';
import type { Application, BindGroup, Buffer, CubeTexture, Renderer, UniformGroup, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { BackgroundPass } from '~/core/render-passes/background/BackgroundPass';
import { ColorCubeTexture } from '~/core/textures/ColorCubeTexture';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import type { PointData3D } from '~/math/vector/PointData3D';
import type { Hemisphere } from '~/scene/lights/environment/Hemisphere';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;
const TOLERANCE = 6;

const UP: PointData3D = { x: 0, y: 1, z: 0 };
const DOWN: PointData3D = { x: 0, y: -1, z: 0 };
const HORIZON: PointData3D = { x: 0, y: 0, z: -1 };

/** Linear 0.5 after the 1/2.2 output curve encodes it */
const HALF_LINEAR = 186;
/** Linear `(0.5, 0, 0.5)`, the half-way blend of blue sky and red ground at the horizon, encoded */
const HORIZON_BLEND = [HALF_LINEAR, 0, HALF_LINEAR];
/**
 * Grey 128 after the sRGB decode (0.2159 linear) and the 1/2.2 encode (0.498)
 *
 * Without the decode, 128/255 would encode to 186.
 */
const DECODED_GREY = 127;

/** The gradient uniforms and bind group the background pass owns */
interface GradientProbe {
  _gradientUniforms: UniformGroup;
  _gradientBindGroup: BindGroup;
}

/** The gradient uniform group and bind group of the view's background pass */
function gradientOf(view3d: View3D): { uniforms: UniformGroup; bindGroup: BindGroup } {
  const pass = view3d._graph.passes.find((p) => p instanceof BackgroundPass) as unknown as GradientProbe;
  return { uniforms: pass._gradientUniforms, bindGroup: pass._gradientBindGroup };
}

/**
 * How many renderers hold a live GPU copy of `buffer`; 0 for no buffer
 *
 * Counts truthy entries, because pixi's GC sets a collected renderer's entry to `null` and keeps
 * the key.
 */
function gpuCopies(buffer: Buffer | undefined): number {
  return buffer ? Object.values(buffer._gpuData).filter(Boolean).length : 0;
}

/**
 * A view with `background`, `none` tone mapping, and one cube placed behind the camera
 *
 * The cube is there because a view with nothing to draw skips its passes, sky included.
 */
function backgroundView(app: Application<Renderer>, background: CubeTexture | Hemisphere): View3D {
  const view3d = new View3D({ width: SIZE, height: SIZE, toneMapping: 'none', background });
  const cube = new Mesh3D({
    geometry: new CubeGeometry({ width: 0.2, height: 0.2, depth: 0.2 }),
    material: new FlatMaterial({ baseColor: 0xffffff }),
  });
  cube.position.set(0, 0, 20);
  view3d.root.addChild(cube);
  app.stage.addChild(view3d);
  return view3d;
}

/** Points the camera from the origin along `direction`, with an up hint that is never parallel to it */
function look(view3d: View3D, direction: PointData3D): void {
  view3d.camera.position.set(0, 0, 0);
  view3d.camera.lookAt(direction, direction.y === 0 ? UP : { x: 0, y: 0, z: -1 });
}

/** The canvas pixel at the centre of the view whose left edge is at `left` */
function readCentre(app: Application<Renderer>, left = 0): number[] {
  return Array.from(readCanvasPixels(app.canvas, left + SIZE / 2, SIZE / 2, 1, 1).subarray(0, 3));
}

/** Renders a frame and reads the canvas pixel at the view's centre in the same task */
function renderCentre(app: Application<Renderer>): number[] {
  app.render();
  return readCentre(app);
}

/**
 * Renders one frame and reads the view's centre in the same task, failing on any WebGPU
 * validation error the frame raised
 */
async function renderCentreCleanly(app: Application<Renderer>): Promise<number[]> {
  const device = (app.renderer as WebGPURenderer).gpu?.device;
  device?.pushErrorScope('validation');
  const rgb = renderCentre(app);
  const error = await device?.popErrorScope();
  expect(error?.message ?? null).toBe(null);
  return rgb;
}

function expectRgb(actual: number[], expected: number[]): void {
  for (let c = 0; c < 3; c++) {
    expect(Math.abs(actual[c] - expected[c]), `rgb(${actual.join(', ')})`).toBeLessThanOrEqual(TOLERANCE);
  }
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`hemisphere background (${preference})`, () => {
    async function withApp(
      id: string,
      run: (app: Application<Renderer>) => Promise<void> | void,
      width = SIZE,
    ): Promise<void> {
      const app = await getApp<Renderer>({
        id: `hemisphere-background-${id}-${preference}`,
        appOptions: { preference, width, height: SIZE, resolution: 1, backgroundColor: 0x000000 },
      });
      try {
        await run(app);
      } finally {
        app.destroy(true, { children: true });
      }
    }

    it('shows the sky colour looking up and the ground colour looking down', async () => {
      await withApp('ends', (app) => {
        const view3d = backgroundView(app, { skyColor: 0x0000ff, groundColor: 0xff0000 });

        look(view3d, UP);
        expectRgb(renderCentre(app), [0, 0, 255]);

        look(view3d, DOWN);
        expectRgb(renderCentre(app), [255, 0, 0]);
      });
    });

    it('blends half-way at the horizon', async () => {
      await withApp('horizon', (app) => {
        const view3d = backgroundView(app, { skyColor: 0x0000ff, groundColor: 0xff0000 });

        look(view3d, HORIZON);
        expectRgb(renderCentre(app), HORIZON_BLEND);
      });
    });

    it('puts the sky along its up axis', async () => {
      await withApp('up', (app) => {
        const view3d = backgroundView(app, { skyColor: 0x0000ff, groundColor: 0xff0000, up: DOWN });

        look(view3d, UP);
        expectRgb(renderCentre(app), [255, 0, 0]);

        look(view3d, DOWN);
        expectRgb(renderCentre(app), [0, 0, 255]);
      });
    });

    it('scales its colours by intensity', async () => {
      await withApp('intensity', (app) => {
        const view3d = backgroundView(app, { skyColor: 0xffffff, groundColor: 0x000000, intensity: 0.5 });

        look(view3d, UP);
        expectRgb(renderCentre(app), [HALF_LINEAR, HALF_LINEAR, HALF_LINEAR]);
      });
    });

    it('decodes its colours from sRGB before the output curve re-encodes them', async () => {
      await withApp('decode', (app) => {
        const view3d = backgroundView(app, { skyColor: 0x808080, groundColor: 0x808080 });

        look(view3d, UP);
        expectRgb(renderCentre(app), [DECODED_GREY, DECODED_GREY, DECODED_GREY]);
      });
    });

    it('takes the view exposure', async () => {
      await withApp('exposure', (app) => {
        const view3d = backgroundView(app, { skyColor: 0xffffff, groundColor: 0xffffff });
        view3d.exposure = 0.5;

        look(view3d, UP);
        expectRgb(renderCentre(app), [HALF_LINEAR, HALF_LINEAR, HALF_LINEAR]);
      });
    });

    it('shows a changed colour on the next frame', async () => {
      await withApp('mutate', (app) => {
        const hemisphere: Hemisphere = { skyColor: 0x0000ff, groundColor: 0xff0000 };
        const view3d = backgroundView(app, hemisphere);
        look(view3d, UP);
        expectRgb(renderCentre(app), [0, 0, 255]);

        hemisphere.skyColor = 0x00ff00;
        expectRgb(renderCentre(app), [0, 255, 0]);
      });
    });

    it('keeps each view on its own colours when two views draw different hemispheres', async () => {
      await withApp(
        'two-views',
        (app) => {
          const left = backgroundView(app, { skyColor: 0x0000ff, groundColor: 0xff0000 });
          const right = backgroundView(app, { skyColor: 0x00ff00, groundColor: 0x00ff00 });
          right.x = SIZE;
          look(left, UP);
          look(right, UP);

          for (let frame = 0; frame < 3; frame++) {
            app.render();
            expectRgb(readCentre(app), [0, 0, 255]);
            expectRgb(readCentre(app, SIZE), [0, 255, 0]);
          }
        },
        SIZE * 2,
      );
    });

    it('draws its own colours under a cube environment', async () => {
      await withApp('cube-environment', (app) => {
        const view3d = backgroundView(app, { skyColor: 0x0000ff, groundColor: 0xff0000 });
        view3d.environment = ColorCubeTexture.fromRGB(120, 140, 160);

        look(view3d, UP);
        expectRgb(renderCentre(app), [0, 0, 255]);

        look(view3d, DOWN);
        expectRgb(renderCentre(app), [255, 0, 0]);
      });
    });

    it('swaps between cube, hemisphere and no background on a live view', async () => {
      await withApp('swap', async (app) => {
        const cube = ColorCubeTexture.fromRGB(40, 160, 220);
        const view3d = backgroundView(app, cube);
        look(view3d, UP);

        const steps: [CubeTexture | Hemisphere | null, number[]][] = [
          [cube, [40, 160, 220]],
          [{ skyColor: 0x0000ff, groundColor: 0xff0000 }, [0, 0, 255]],
          [cube, [40, 160, 220]],
          [null, [0, 0, 0]],
        ];
        for (const [background, expected] of steps) {
          view3d.background = background;
          expectRgb(await renderCentreCleanly(app), expected);
        }
      });
    });

    it('lets go of a cubemap once the background becomes a hemisphere', async () => {
      await withApp('cube-release', async (app) => {
        const cube = ColorCubeTexture.fromRGB(40, 160, 220);
        const view3d = backgroundView(app, cube);
        look(view3d, UP);
        app.render();

        view3d.background = { skyColor: 0x0000ff, groundColor: 0xff0000 };
        app.render();

        expect(captureWarnings(() => cube.destroy(true))).toEqual([]);
        await expectCleanRender(app);
      });
    });

    it('releases its gradient uniforms when the view is destroyed', async () => {
      await withApp('destroy', (app) => {
        const view3d = backgroundView(app, { skyColor: 0x0000ff, groundColor: 0xff0000 });
        look(view3d, UP);
        app.render();

        const { uniforms, bindGroup } = gradientOf(view3d);
        view3d.destroy({ children: true });

        expect(bindGroup.resources).toBeNull();
        expect(
          uniforms.buffer?.destroyed,
          'WebGPU destroys its buffer; WebGL never has one, since it syncs the group through uniform calls',
        ).toBe(preference === 'webgpu' ? true : undefined);
      });
    });

    it('frees its gradient buffer on unload and draws the same gradient after', async () => {
      await withApp('unload', async (app) => {
        const view3d = backgroundView(app, { skyColor: 0x0000ff, groundColor: 0xff0000 });
        look(view3d, UP);
        expectRgb(renderCentre(app), [0, 0, 255]);

        const { buffer } = gradientOf(view3d).uniforms;
        /** Only WebGPU creates the uniform buffer; WebGL syncs the group through uniform calls */
        const resident = preference === 'webgpu' ? 1 : 0;
        expect(gpuCopies(buffer)).toBe(resident);

        view3d.unload();
        expect(gpuCopies(buffer)).toBe(0);

        await expectCleanRender(app);
        expectRgb(renderCentre(app), [0, 0, 255]);
        expect(gpuCopies(buffer)).toBe(resident);
      });
    });
  });
}
