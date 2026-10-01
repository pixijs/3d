import { getApp, readCanvasPixels } from '@test-utils';
import { RenderTexture } from 'pixi.js';
import type { Application, Renderer, RenderTarget, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import type { RenderGraph } from '~/core/render-graph/RenderGraph';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { Pass3D } from '~/post-processing/Pass3D';
import type { PassContext, PassStage } from '~/post-processing/Pass3D';
import { MeshPass } from '~/post-processing/passes/MeshPass';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

type FeedMode = 'none' | Exclude<PassStage, 'post'>;

interface GlassScene {
  view3d: View3D;
  feed: RenderTexture;
  feedCamera: Camera3D;
}

/**
 * The view sees a green wall through a clear glass pane; a feed camera, far above, sees only a red
 * wall and draws it into its texture
 *
 * The glass must read green. Red means the view's opaque copy was taken from the feed. The view
 * sits in the right half of a blue canvas, away from the origin the feed's own rect starts at, so
 * blue means the copy took the feed's rect of the screen instead of the view's.
 */
function buildScene(
  app: Application<Renderer>,
  options: { feedMode: FeedMode; composite: boolean; feedMips?: boolean },
): GlassScene {
  const view3d = new View3D({ width: SIZE, height: SIZE, composite: options.composite });
  view3d.position.set(SIZE, 0);
  view3d.camera.position.set(0, 0, 3);

  /** An unlit wall, so the readback sees its colour as authored in a view with no lights */
  const wall = (color: number, y: number): Mesh3D => {
    const mesh = new Mesh3D({
      geometry: new PlaneGeometry({ width: 40, height: 40 }),
      material: new FlatMaterial({ baseColor: color }),
    });
    mesh.position.set(0, y, -2);
    return mesh;
  };

  view3d.root.addChild(wall(0x00ff00, 0));
  view3d.root.addChild(wall(0xff0000, 200));

  /** A clear, flat pane: IOR 1 and no thickness, so it shows what is straight behind it */
  const glass = new Mesh3D({
    geometry: new PlaneGeometry({ width: 3, height: 3 }),
    material: new Material3D({
      baseColor: 0xffffff,
      metallic: 0,
      roughness: 0,
      ior: 1,
      transmission: { factor: 1, thickness: 0 },
    }),
    castShadow: false,
    receiveShadow: false,
  });
  view3d.root.addChild(glass);

  /** View-sized, so a copy taken from the feed's target would fill the glass with the red wall */
  const feed = RenderTexture.create({
    width: SIZE,
    height: SIZE,
    resolution: 1,
    autoGenerateMipmaps: options.feedMips ?? false,
  });
  /** Level with the red wall, far outside the view camera's frustum */
  const feedCamera = new Camera3D({ renderTexture: feed });
  feedCamera.position.set(0, 200, 3);
  view3d.root.addChild(feedCamera);
  if (options.feedMode !== 'none') {
    view3d.passes = [new MeshPass({ name: 'opaque', camera: feedCamera, stage: options.feedMode })];
  }

  app.stage.addChild(view3d);

  return { view3d, feed, feedCamera };
}

/** Reads the view's depth copy and draws nothing, so the graph keeps the copy in the frame */
class ReadsOpaqueDepth extends Pass3D {
  public readonly stage: Exclude<PassStage, 'post'> = 'afterTransparent';

  public build(graph: RenderGraph, ctx: PassContext): void {
    graph.addPass({
      name: 'opaqueDepthReader',
      bit: RenderPassBit.NONE,
      setup(b) {
        b.read(ctx.opaqueDepth);
        b.writeColor(b.targetColor);
        b.writeDepth(b.targetDepth);
      },
      render() {},
    });
  }
}

interface Verdict {
  wall: 'scene' | 'feed' | 'background' | 'none';
  rgb: string;
}

/**
 * What a pixel of the glass pane shows, and its RGB for the failure message
 *
 * The glass is lit and tone mapped on top of what it refracts, so the verdict is the channel
 * that dominates rather than an exact colour.
 */
function wallShown(r: number, g: number, b: number): Verdict {
  const rgb = `rgb(${r}, ${g}, ${b})`;

  if (g - r > 48 && g - b > 48) return { wall: 'scene', rgb };
  if (r - g > 48 && r - b > 48) return { wall: 'feed', rgb };
  if (b - r > 48 && b - g > 48) return { wall: 'background', rgb };

  return { wall: 'none', rgb };
}

/**
 * The view's centre, where only the glass pane is, in the canvas frame the last render drew
 *
 * Reads the canvas itself: `extract.pixels` on the stage would render it again into another target.
 */
function seenThroughGlass(app: Application<Renderer>): Verdict {
  const [r, g, b] = readCanvasPixels(app.canvas, SIZE + SIZE / 2, SIZE / 2, 1, 1);

  return wallShown(r, g, b);
}

/** The same pixel in `texture`, which the stage was rendered into */
function seenThroughGlassIn(app: Application<Renderer>, texture: RenderTexture): Verdict {
  const { pixels, width, height } = app.renderer.extract.pixels({ target: texture });
  const i = ((height >> 1) * width + ((width * 3) >> 2)) * 4;

  return wallShown(pixels[i], pixels[i + 1], pixels[i + 2]);
}

/** Renders one frame, failing on any WebGPU validation error the frame raised */
async function renderClean(app: Application<Renderer>): Promise<void> {
  const device = (app.renderer as WebGPURenderer).gpu?.device;
  device?.pushErrorScope('validation');
  app.render();
  const error = device ? await device.popErrorScope() : null;
  expect(error?.message ?? null).toBe(null);
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`opaque copy after a camera pass (${preference})`, () => {
    for (const composite of [false, true]) {
      const mode = composite ? 'composite' : 'direct';

      for (const feedMode of ['none', 'beforeOpaque', 'afterOpaque'] as const) {
        /**
         * With and without mipmaps on the feed: the graph generates them before the view's copies,
         * which on WebGL binds the view's outer target again, without the view's rect
         */
        const feedMipsCases = feedMode === 'none' ? [false] : [false, true];
        for (const feedMips of feedMipsCases) {
          const feedLabel =
            feedMode === 'none' ? 'with no feed' : `with the ${feedMips ? 'mip-chained ' : ''}feed at '${feedMode}'`;

          it(`glass refracts the view's scene, not the feed, ${feedLabel} (${mode})`, async () => {
            const app = await getApp<Renderer>({
              id: `opaque-copy-after-camera-${feedMode}-${feedMips}-${mode}-${preference}`,
              appOptions: {
                preference,
                width: SIZE * 2,
                height: SIZE,
                resolution: 1,
                backgroundColor: 0x0000ff,
                useBackBuffer: true,
              },
            });

            let feed: RenderTexture | null = null;
            try {
              expect(app.renderer.name).toBe(preference);
              feed = buildScene(app, { feedMode, composite, feedMips }).feed;

              app.render();

              const { wall, rgb } = seenThroughGlass(app);

              expect(wall, rgb).toBe('scene');
            } finally {
              feed?.destroy(true);
              app.destroy();
            }
          });
        }
      }

      /**
       * WebGL draws an antialiased frame with a View3D in it black, feed or no feed (#461), so a
       * verdict there says nothing about the copy
       */
      const msaaDrawsNothing = preference === 'webgl';
      it.skipIf(msaaDrawsNothing)(
        `glass refracts the view's scene on a multisampled canvas, with the feed at 'afterOpaque' (${mode})`,
        async () => {
          const app = await getApp<Renderer>({
            id: `opaque-copy-msaa-${mode}-${preference}`,
            appOptions: {
              preference,
              width: SIZE * 2,
              height: SIZE,
              resolution: 1,
              backgroundColor: 0x0000ff,
              useBackBuffer: true,
              antialias: true,
            },
          });

          let feed: RenderTexture | null = null;
          try {
            feed = buildScene(app, { feedMode: 'afterOpaque', composite }).feed;

            app.render();

            const { wall, rgb } = seenThroughGlass(app);

            expect(wall, rgb).toBe('scene');
          } finally {
            feed?.destroy(true);
            app.destroy();
          }
        },
      );

      it(`glass still refracts the view's scene after the view is drawn into another target (${mode})`, async () => {
        const app = await getApp<Renderer>({
          id: `opaque-copy-retarget-${mode}-${preference}`,
          appOptions: {
            preference,
            width: SIZE * 2,
            height: SIZE,
            resolution: 1,
            backgroundColor: 0x0000ff,
            useBackBuffer: true,
          },
        });
        /**
         * Drawing the stage here makes the graph drop every render target it cached, while the pooled
         * textures under the feed's target and the scene's stay the same
         */
        const offscreen = RenderTexture.create({ width: SIZE * 2, height: SIZE, resolution: 1 });

        let feed: RenderTexture | null = null;
        try {
          feed = buildScene(app, { feedMode: 'afterOpaque', composite }).feed;

          app.render();
          const onCanvas = seenThroughGlass(app);
          expect(onCanvas.wall, onCanvas.rgb).toBe('scene');

          app.renderer.render({ container: app.stage, target: offscreen });
          const inTexture = seenThroughGlassIn(app, offscreen);
          expect(inTexture.wall, inTexture.rgb).toBe('scene');

          app.render();
          const backOnCanvas = seenThroughGlass(app);
          expect(backOnCanvas.wall, backOnCanvas.rgb).toBe('scene');
        } finally {
          offscreen.destroy(true);
          feed?.destroy(true);
          app.destroy();
        }
      });

      it(`drops the targets its copies read when the view is destroyed (${mode})`, async () => {
        const app = await getApp<Renderer>({
          id: `opaque-copy-release-${mode}-${preference}`,
          appOptions: { preference, width: SIZE * 2, height: SIZE, useBackBuffer: true },
        });

        let feed: RenderTexture | null = null;
        try {
          const scene = buildScene(app, { feedMode: 'afterOpaque', composite });
          feed = scene.feed;

          app.render();

          const graph = scene.view3d._graph;
          const feedTarget = graph._cameraTarget(scene.feedCamera);

          expect(graph['_sceneDrawTarget'], "the view's glass copy looked its target up").not.toBeNull();
          expect(feedTarget.draw, "the feed's copy into its texture looked its target up").not.toBeNull();

          scene.view3d.destroy();

          expect(graph['_sceneDrawTarget']).toBeNull();
          expect(graph['_cameraTargets'].size).toBe(0);
        } finally {
          feed?.destroy(true);
          app.destroy();
        }
      });

      it(`the view's copy binds nothing, even after a camera pass bound its own target (${mode})`, async () => {
        const app = await getApp<Renderer>({
          id: `opaque-copy-binds-${mode}-${preference}`,
          appOptions: { preference, width: SIZE * 2, height: SIZE, useBackBuffer: true },
        });

        let feed: RenderTexture | null = null;
        try {
          const scene = buildScene(app, { feedMode: 'beforeOpaque', composite });
          feed = scene.feed;
          const { view3d, feedCamera } = scene;

          /** What happens between the view's opaque draw and the copy of it, in order */
          const events: string[] = [];
          let drawnTarget: RenderTarget | null = null;
          let copiedTarget: RenderTarget | null = null;
          const pipe = (app.renderer as WebGLRenderer | WebGPURenderer).renderPipes.view3d;
          const renderForward = pipe.renderForward.bind(pipe);
          const copyColor = pipe.copyColor.bind(pipe);
          const renderTargetSystem = app.renderer.renderTarget;
          const bind = renderTargetSystem.bind.bind(renderTargetSystem);
          vi.spyOn(pipe, 'renderForward').mockImplementation((desc, session) => {
            if (desc.camera === feedCamera) events.push('feed draw');
            else if (desc.bit === RenderPassBit.OPAQUE) {
              events.push('opaque draw');
              drawnTarget = renderTargetSystem.renderTarget;
            }
            renderForward(desc, session);
          });
          vi.spyOn(pipe, 'copyColor').mockImplementation((source, dest, session) => {
            const isFeed = dest === feed;
            events.push(isFeed ? 'feed copy' : 'opaque copy');
            if (!isFeed) copiedTarget = source.target;
            copyColor(source, dest, session);
          });
          vi.spyOn(renderTargetSystem, 'bind').mockImplementation(((...args: Parameters<typeof bind>) => {
            events.push('bind');
            return bind(...args);
          }) as typeof bind);

          const betweenOpaqueDrawAndCopy = (): string[] => {
            events.length = 0;
            app.render();
            return events.slice(events.lastIndexOf('opaque draw') + 1, events.indexOf('opaque copy'));
          };

          expect(betweenOpaqueDrawAndCopy(), 'the copy is handed the target it reads, so it binds nothing').toEqual([]);
          expect(copiedTarget, 'the target the opaque draw bound, not a second one around the same textures').toBe(
            drawnTarget,
          );

          view3d.passes = [new MeshPass({ name: 'opaque', camera: feedCamera, stage: 'afterOpaque' })];
          expect(betweenOpaqueDrawAndCopy(), "with the feed at 'afterOpaque', the only bind is the feed's own").toEqual(
            ['bind', 'feed draw', 'feed copy'],
          );
          expect(copiedTarget).toBe(drawnTarget);
        } finally {
          vi.restoreAllMocks();
          feed?.destroy(true);
          app.destroy();
        }
      });

      it(`the view's depth copy reads the view's target, after a camera pass bound its own (${mode})`, async () => {
        /**
         * View-sized, with the view moved to the origin below, so the depth copy takes the whole
         * texture, since WebGPU rejects a partial copy of one. No ticker: `renderClean` waits on the
         * device, and a frame the ticker drew meanwhile would count with the one under test.
         */
        const app = await getApp<Renderer>({
          id: `opaque-copy-depth-${mode}-${preference}`,
          appOptions: { preference, width: SIZE, height: SIZE, resolution: 1, useBackBuffer: true, autoStart: false },
        });

        let feed: RenderTexture | null = null;
        try {
          const scene = buildScene(app, { feedMode: 'afterOpaque', composite });
          feed = scene.feed;
          const { view3d, feedCamera } = scene;
          view3d.position.set(0, 0);
          view3d.passes = [...view3d.passes, new ReadsOpaqueDepth()];

          let drawnTarget: RenderTarget | null = null;
          let copiedTarget: RenderTarget | null = null;
          const pipe = (app.renderer as WebGLRenderer | WebGPURenderer).renderPipes.view3d;
          const renderForward = pipe.renderForward.bind(pipe);
          const copyDepth = pipe.copyDepth.bind(pipe);
          vi.spyOn(pipe, 'renderForward').mockImplementation((desc, session) => {
            if (desc.camera !== feedCamera && desc.bit === RenderPassBit.OPAQUE) {
              drawnTarget = app.renderer.renderTarget.renderTarget;
            }
            renderForward(desc, session);
          });
          /**
           * Records the depth copy and runs it on WebGPU only: pixi's WebGL depth copy wraps `dest` in a
           * render target of its own, which destroying the renderer destroys while the shared pool
           * still holds it
           */
          const copies = vi.spyOn(pipe, 'copyDepth').mockImplementation((source, dest, session) => {
            copiedTarget = source.target;
            if (preference === 'webgpu') copyDepth(source, dest, session);
          });

          await renderClean(app);

          expect(copies).toHaveBeenCalledTimes(1);
          expect(drawnTarget).not.toBeNull();
          expect(copiedTarget).toBe(drawnTarget);
        } finally {
          vi.restoreAllMocks();
          feed?.destroy(true);
          app.destroy();
        }
      });
    }
  });
}
