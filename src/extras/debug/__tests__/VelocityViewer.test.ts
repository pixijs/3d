import { getApp, renderFrame } from '@test-utils';
import { AlphaFilter } from 'pixi.js';
import type { Application, Renderer } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';

import { velocityOutput } from '~/extras/scene-outputs/velocityOutput';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import { VelocityViewer } from '../VelocityViewer';

const SIZE = 32;
const RESOLUTION = 2;
const PHYSICAL = SIZE * RESOLUTION;
const WORLD_PER_PIXEL = 20 / PHYSICAL;

function centre(pixels: Uint8ClampedArray): [number, number, number] {
  const i = ((PHYSICAL / 2) * PHYSICAL + PHYSICAL / 2) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
}

describe('VelocityViewer', () => {
  const defaults = { ...VelocityViewer.defaultOptions };

  afterEach(() => {
    VelocityViewer.defaultOptions = { ...defaults };
  });

  it('uses the velocity output and reads its scale from defaultOptions', () => {
    expect(new VelocityViewer().requiredOutputs).toEqual([velocityOutput]);
    expect(new VelocityViewer().scale).toBe(0.25);

    VelocityViewer.defaultOptions.scale = 2;
    expect(new VelocityViewer().scale).toBe(2);
    expect(new VelocityViewer({ scale: undefined }).scale).toBe(2);

    const viewer = new VelocityViewer({ scale: 0.5 });
    expect(viewer.scale).toBe(0.5);
    viewer.scale = 3;
    expect(viewer.scale).toBe(3);
  });

  for (const preference of ['webgpu', 'webgl'] as const) {
    describe(`on ${preference}`, () => {
      let app: Application<Renderer>;
      let view3d: View3D;
      let viewer: VelocityViewer;

      afterEach(() => {
        view3d?.destroy(true);
        app?.destroy();
      });

      async function setup(id: string): Promise<void> {
        app = await getApp<Renderer>({
          id: `velocity-viewer-${id}-${preference}`,
          appOptions: {
            preference,
            width: SIZE,
            height: SIZE,
            resolution: RESOLUTION,
            backgroundColor: 0x000000,
            autoStart: false,
          },
        });
        expect(app.renderer.name).toBe(preference);

        viewer = new VelocityViewer({ scale: 0.5 });
        view3d = new View3D({ width: SIZE, height: SIZE, passes: [viewer] });
        app.stage.addChild(view3d);

        view3d.camera.useOrthographic(10, 0.1, 100);
        view3d.camera.position.set(0, 0, 10);
        view3d.root.addChild(
          new Mesh3D({ geometry: new PlaneGeometry({ width: 400, height: 400 }), material: new FlatMaterial() }),
        );
      }

      it('shows a still camera as black', async () => {
        await setup('still');

        await renderFrame(app);
        expect(centre(await renderFrame(app))).toEqual([0, 0, 0]);
      });

      it('shows a surface moving right as red and one moving up as yellow-green', async () => {
        await setup('directions');

        await renderFrame(app);
        view3d.camera.position.set(-2 * WORLD_PER_PIXEL, 0, 10);
        const [rightR, rightG, rightB] = centre(await renderFrame(app));
        expect(rightR).toBe(255);
        expect(rightG).toBeLessThan(8);
        expect(rightB).toBeLessThan(8);

        view3d.camera.position.set(-2 * WORLD_PER_PIXEL, -2 * WORLD_PER_PIXEL, 10);
        const [upR, upG, upB] = centre(await renderFrame(app));
        expect(Math.abs(upR - 128)).toBeLessThan(8);
        expect(upG).toBe(255);
        expect(upB).toBeLessThan(8);
      });

      it('shows the same hues when the view draws into a 2D filter', async () => {
        await setup('filter');
        view3d.filters = [new AlphaFilter({ alpha: 1, resolution: RESOLUTION })];

        await renderFrame(app);
        view3d.camera.position.set(0, -2 * WORLD_PER_PIXEL, 10);
        const [upR, upG, upB] = centre(await renderFrame(app));
        expect(Math.abs(upR - 128), 'a surface moving up reads yellow-green').toBeLessThan(8);
        expect(upG).toBe(255);
        expect(upB).toBeLessThan(8);
      });

      it('scales brightness with the speed in pixels', async () => {
        await setup('speed');
        viewer.scale = 0.25;

        await renderFrame(app);
        view3d.camera.position.set(-2 * WORLD_PER_PIXEL, 0, 10);
        const [r] = centre(await renderFrame(app));
        expect(Math.abs(r - 128)).toBeLessThan(8);
      });
    });
  }
});
