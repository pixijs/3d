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
import type { PassContext, SceneStage } from '~/post-processing/Pass3D';
import { MeshPass } from '~/post-processing/passes/MeshPass';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

type FeedMode = 'none' | SceneStage;

interface GlassScene {
  view3d: View3D;
  feed: RenderTexture;
  feedCamera: Camera3D;
}

function buildScene(
  app: Application<Renderer>,
  options: { feedMode: FeedMode; composite: boolean; feedMips?: boolean },
): GlassScene {
  const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE, composite: options.composite });
  view3d.position.set(SIZE, 0);
  view3d.camera.position.set(0, 0, 3);

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

  const feed = RenderTexture.create({
    width: SIZE,
    height: SIZE,
    resolution: 1,
    autoGenerateMipmaps: options.feedMips ?? false,
  });
  const feedCamera = new Camera3D({ renderTexture: feed });
  feedCamera.position.set(0, 200, 3);
  view3d.root.addChild(feedCamera);
  if (options.feedMode !== 'none') {
    view3d.passes = [new MeshPass({ name: 'opaque', camera: feedCamera, stage: options.feedMode })];
  }

  app.stage.addChild(view3d);

  return { view3d, feed, feedCamera };
}

class ReadsOpaqueDepth extends Pass3D {
  public readonly stage: SceneStage = 'afterTransparent';

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

function wallShown(r: number, g: number, b: number): Verdict {
  const rgb = `rgb(${r}, ${g}, ${b})`;

  if (g - r > 48 && g - b > 48) return { wall: 'scene', rgb };
  if (r - g > 48 && r - b > 48) return { wall: 'feed', rgb };
  if (b - r > 48 && b - g > 48) return { wall: 'background', rgb };

  return { wall: 'none', rgb };
}

function seenThroughGlass(app: Application<Renderer>): Verdict {
  const [r, g, b] = readCanvasPixels(app.canvas, SIZE + SIZE / 2, SIZE / 2, 1, 1);

  return wallShown(r, g, b);
}

function seenThroughGlassIn(app: Application<Renderer>, texture: RenderTexture): Verdict {
  const { pixels, width, height } = app.renderer.extract.pixels({ target: texture });
  const i = ((height >> 1) * width + ((width * 3) >> 2)) * 4;

  return wallShown(pixels[i], pixels[i + 1], pixels[i + 2]);
}

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
          expect(graph['_cameraTargets']).toBeNull();
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
          vi.spyOn(renderTargetSystem, 'bind').mockImplementation((...args: Parameters<typeof bind>) => {
            events.push('bind');
            return bind(...args);
          });

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
