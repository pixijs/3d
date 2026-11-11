import { captureWarnings, expectCleanRender, getApp, readCanvasPixels } from '@test-utils';
import type { Application, BindGroup, Buffer, ColorSource, Renderer, UniformGroup, WebGPURenderer } from 'pixi.js';
import { Color, CubeTexture, Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { BackgroundPass } from '~/core/render-passes/background/BackgroundPass';
import { ColorCubeTexture } from '~/core/textures/ColorCubeTexture';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import type { PointData3D } from '~/math/vector/PointData3D';
import type { Hemisphere } from '~/scene/lights/environment/Hemisphere';
import { Mesh3D } from '~/scene/Mesh3D';
import type { ToneMapping } from '~/scene/View3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;
const TOLERANCE = 6;

const UP: PointData3D = { x: 0, y: 1, z: 0 };
const DOWN: PointData3D = { x: 0, y: -1, z: 0 };
const HORIZON: PointData3D = { x: 0, y: 0, z: -1 };

const HALF_LINEAR = 186;
const HORIZON_BLEND = [HALF_LINEAR, 0, HALF_LINEAR];
const DECODED_GREY = 127;

interface GradientProbe {
  _gradientUniforms: UniformGroup;
  _gradientBindGroup: BindGroup;
}

function gradientOf(view3d: View3D): { uniforms: UniformGroup; bindGroup: BindGroup } {
  const pass = view3d._graph.passes.find((p) => p instanceof BackgroundPass) as unknown as GradientProbe;
  return { uniforms: pass._gradientUniforms, bindGroup: pass._gradientBindGroup };
}

function gpuCopies(buffer: Buffer | undefined): number {
  return buffer ? Object.values(buffer._gpuData).filter(Boolean).length : 0;
}

function backgroundView(app: Application<Renderer>, background: CubeTexture | Hemisphere | ColorSource): View3D {
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

function look(view3d: View3D, direction: PointData3D): void {
  view3d.camera.position.set(0, 0, 0);
  view3d.camera.lookAt(direction, direction.y === 0 ? UP : { x: 0, y: 0, z: -1 });
}

function readCentre(app: Application<Renderer>, left = 0): number[] {
  return Array.from(readCanvasPixels(app.canvas, left + SIZE / 2, SIZE / 2, 1, 1).subarray(0, 3));
}

function renderCentre(app: Application<Renderer>): number[] {
  app.render();
  return readCentre(app);
}

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

describe('colour background', () => {
  it('takes any ColorSource and reads it back as a hex number', () => {
    const view3d = new View3D({ background: 0x968c34 });
    expect(view3d.background).toBe(0x968c34);

    const forms: [ColorSource, number][] = [
      ['skyblue', 0x87ceeb],
      ['#ff000080', 0xff0000],
      [[0, 1, 0], 0x00ff00],
      [{ r: 0, g: 0, b: 255 }, 0x0000ff],
      [new Color(0x123456), 0x123456],
      [0, 0],
    ];
    for (const [value, hex] of forms) {
      view3d.background = value;
      expect(view3d.background, JSON.stringify(value)).toBe(hex);
    }
    view3d.destroy();
  });

  it('keeps a hemisphere or cubemap as the object it was given', () => {
    const hemisphere: Hemisphere = { skyColor: 0x0000ff, groundColor: 0xff0000 };
    const view3d = new View3D({ background: hemisphere });
    expect(view3d.background).toBe(hemisphere);

    const cube = ColorCubeTexture.from(0xffffff);
    view3d.background = cube;
    expect(view3d.background).toBe(cube);
    expect(view3d.background).toBeInstanceOf(CubeTexture);

    view3d.background = null;
    expect(view3d.background).toBeNull();
    view3d.destroy();
    cube.destroy(true);
  });
});

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

    it('lets go of its gradient buffer on unload and draws the same gradient with a rebuilt one', async () => {
      await withApp('unload', async (app) => {
        const view3d = backgroundView(app, { skyColor: 0x0000ff, groundColor: 0xff0000 });
        look(view3d, UP);
        expectRgb(renderCentre(app), [0, 0, 255]);

        const { buffer } = gradientOf(view3d).uniforms;
        const resident = preference === 'webgpu' ? 1 : 0;
        expect(gpuCopies(buffer)).toBe(resident);

        view3d.unload();
        expect(gpuCopies(buffer)).toBe(0);

        await expectCleanRender(app);
        expectRgb(renderCentre(app), [0, 0, 255]);
        expect(gpuCopies(buffer), 'the old buffer stays gone').toBe(0);
        expect(gpuCopies(gradientOf(view3d).uniforms.buffer), 'the rebuilt pass uploads its own').toBe(resident);
      });
    });

    it('draws a colour the same in every direction', async () => {
      await withApp('colour', (app) => {
        const view3d = backgroundView(app, 0x808080);

        for (const direction of [UP, DOWN, HORIZON]) {
          look(view3d, direction);
          expectRgb(renderCentre(app), [DECODED_GREY, DECODED_GREY, DECODED_GREY]);
        }
      });
    });

    it('draws a black colour over what is behind the view', async () => {
      await withApp('black', (app) => {
        app.stage.addChild(new Graphics().rect(0, 0, SIZE, SIZE).fill(0xffffff));
        const view3d = backgroundView(app, 0x000000);
        look(view3d, UP);

        expectRgb(renderCentre(app), [0, 0, 0]);
      });
    });

    it('swaps between a colour, a hemisphere and a cubemap on a live view', async () => {
      await withApp('colour-swap', async (app) => {
        const cube = ColorCubeTexture.fromRGB(40, 160, 220);
        const view3d = backgroundView(app, 0x00ff00);
        look(view3d, UP);

        const steps: [CubeTexture | Hemisphere | ColorSource | null, number[]][] = [
          [0x00ff00, [0, 255, 0]],
          [{ skyColor: 0x0000ff, groundColor: 0xff0000 }, [0, 0, 255]],
          ['red', [255, 0, 0]],
          [cube, [40, 160, 220]],
          [0x00ff00, [0, 255, 0]],
          [null, [0, 0, 0]],
        ];
        for (const [background, expected] of steps) {
          view3d.background = background;
          expectRgb(await renderCentreCleanly(app), expected);
        }

        expect(
          captureWarnings(() => cube.destroy(true)),
          'the colour let go of the cubemap',
        ).toEqual([]);
      });
    });

    for (const toneMapping of ['aces', 'reinhard', 'uncharted2', 'none', 'custom'] as ToneMapping[]) {
      it(`meets fully fogged geometry with no seam under '${toneMapping}' and exposure 1.7`, async () => {
        await withApp(`fog-seam-${toneMapping}`, (app) => {
          const colour = 0x968c34;
          const view3d = new View3D({ width: SIZE, height: SIZE, toneMapping, exposure: 1.7, background: colour });
          const wall = new Mesh3D({
            geometry: new CubeGeometry({ width: 40, height: 40, depth: 1 }),
            material: new FlatMaterial({ baseColor: 0xff00ff }),
          });
          wall.position.set(0, 0, -10);
          view3d.root.addChild(wall);
          app.stage.addChild(view3d);
          look(view3d, HORIZON);

          const unfogged = renderCentre(app);
          view3d.fog = { type: 'linear', color: colour, near: 1, far: 2 };
          const fogged = renderCentre(app);
          wall.visible = false;
          const sky = renderCentre(app);

          expect(unfogged, 'the wall draws').not.toEqual(sky);
          for (let c = 0; c < 3; c++) {
            expect(
              Math.abs(fogged[c] - sky[c]),
              `fog rgb(${fogged.join(', ')}) vs sky rgb(${sky.join(', ')})`,
            ).toBeLessThanOrEqual(1);
          }
        });
      });
    }
  });
}
