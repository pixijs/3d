import { getApp } from '@test-utils';
import { CLEAR, Rectangle, RenderTarget, RenderTexture, TextureSource } from 'pixi.js';
import type { BindOptions, Renderer, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { getCameraData } from '~/core/CameraData';
import { updateCameraProjectionForTarget } from '~/core/prepareCamera';
import type { RenderGraph } from '~/core/render-graph/RenderGraph';
import { CopyDepthPass } from '~/core/render-passes/copy-depth/CopyDepthPass';
import { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { Plane } from '~/math/shapes/Plane';
import { Vector3 } from '~/math/vector/Vector3';
import { Pass3D } from '~/post-processing/Pass3D';
import type { PassContext, PassStage } from '~/post-processing/Pass3D';
import { MeshPass } from '~/post-processing/passes/MeshPass';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const FEED_WIDTH = 128;
const FEED_HEIGHT = 72;

/** Adds one opaque forward pass from `camera` before the scene draws */
class FeedPass extends Pass3D {
  public readonly stage: Exclude<PassStage, 'post'> = 'beforeOpaque';

  constructor(private readonly _camera: Camera3D) {
    super();
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    graph.addPass(new ForwardRenderPass({ renderer: ctx.renderer, name: 'opaque', sort: 'key', camera: this._camera }));
  }
}

/**
 * Adds an opaque forward pass from `camera`, a copy of its depth, and a view pass that reads that copy
 * so the graph keeps the copy
 *
 * The camera's last pass is then the depth copy, which doesn't write the camera's colour.
 */
class FeedDepthCopyPass extends Pass3D {
  public readonly stage: Exclude<PassStage, 'post'> = 'beforeOpaque';

  constructor(private readonly _camera: Camera3D) {
    super();
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    const { renderer } = ctx;
    const camera = this._camera;
    const { width, height } = camera.renderTexture!;
    const opaqueDepthHandle = graph.createDepth({ width, height, resolution: 1, label: 'feedOpaqueDepth' });

    graph.addPass(new ForwardRenderPass({ renderer, name: 'opaque', sort: 'key', camera }));
    graph.addPass(new CopyDepthPass({ renderer, camera, opaqueDepthHandle }));
    graph.addPass({
      name: 'feedDepthReader',
      bit: RenderPassBit.NONE,
      setup(b) {
        b.read(opaqueDepthHandle);
        b.writeColor(b.targetColor);
        b.writeDepth(b.targetDepth);
      },
      render() {},
    });
  }
}

/** Adds one opaque forward pass from `camera` onto the view's own target */
class InsetPass extends Pass3D {
  public readonly stage: Exclude<PassStage, 'post'> = 'afterTransparent';

  constructor(private readonly _camera: Camera3D) {
    super();
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    graph.addPass(new ForwardRenderPass({ renderer: ctx.renderer, name: 'opaque', sort: 'key', camera: this._camera }));
  }
}

function buildScene(display: RenderTexture): { view3d: View3D; feedCamera: Camera3D; insetCamera: Camera3D } {
  const view3d = new View3D({ width: 128, height: 128 });
  const mesh = new Mesh3D({
    geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
    material: new Material3D({ baseColor: 0xff0000 }),
  });
  mesh.position.set(0, 0, -3);
  view3d.root.addChild(mesh);

  const feedCamera = new Camera3D({ renderTexture: display });
  feedCamera.position.set(0, 2, 2);
  view3d.root.addChild(feedCamera);

  const insetCamera = new Camera3D();
  insetCamera.position.set(2, 0, 2);
  insetCamera.viewport.width = 0.4;
  insetCamera.viewport.height = 0.4;
  view3d.root.addChild(insetCamera);

  return { view3d, feedCamera, insetCamera };
}

describe('updateCameraProjectionForTarget', () => {
  it('takes its aspect from the rect the camera fills, not from the view, with no shift when nothing is clipped', () => {
    const camera = new Camera3D({ fov: 60 });
    const frame = updateCameraProjectionForTarget(camera, FEED_WIDTH, FEED_HEIGHT);

    expect(frame).toBeDefined();
    expect([frame!.x, frame!.y, frame!.width, frame!.height]).toEqual([0, 0, FEED_WIDTH, FEED_HEIGHT]);

    /** `1 / tan(fov / 2)` at 60°: the projection's y scale, and its x scale times the aspect */
    const f = 1 / Math.tan(Math.PI / 6);
    const e = camera.projection.elements;
    expect(e[0]).toBeCloseTo(f / (FEED_WIDTH / FEED_HEIGHT), 5);
    expect(e[5]).toBeCloseTo(f, 5);
    expect(e[8]).toBeCloseTo(0, 6);
    expect(e[9]).toBeCloseTo(0, 6);
  });

  it('maps the projection when the camera viewport runs off the target', () => {
    const camera = new Camera3D({ fov: 60 });
    camera.viewport.x = 0.75;
    camera.viewport.width = 0.5;

    const frame = updateCameraProjectionForTarget(camera, FEED_WIDTH, FEED_HEIGHT)!;

    expect(
      [frame.x, frame.y, frame.width, frame.height],
      'asked for 96..192 of a 128-wide texture, 96..128 is what is left',
    ).toEqual([96, 0, 32, FEED_HEIGHT]);

    /** `1 / tan(fov / 2)` at 60° */
    const f = 1 / Math.tan(Math.PI / 6);
    const unclippedAspect = (FEED_WIDTH * 0.5) / FEED_HEIGHT;
    const e = camera.projection.elements;
    expect(e[0], "the unclipped rect's aspect, zoomed into the visible half").toBeCloseTo((f / unclippedAspect) * 2, 5);
    expect(e[5]).toBeCloseTo(f, 5);
    expect(
      e[8],
      'the visible centre (112) sits one half-width of what is left from the intended one (128)',
    ).toBeCloseTo(-1, 5);
  });

  it('reports no frame when the camera lands entirely off the target', () => {
    const camera = new Camera3D();
    camera.viewport.x = 1.4;

    expect(updateCameraProjectionForTarget(camera, FEED_WIDTH, FEED_HEIGHT)).toBeUndefined();
  });

  it('makes the clipping plane the near plane and the far corner the far plane', () => {
    /** How far in front of the camera the clipping plane sits, facing away so it keeps everything beyond */
    const distance = 5;
    const camera = new Camera3D({ fov: 60, near: 0.1, far: 100 });
    camera.clippingPlane = new Plane(new Vector3(0, 0, -1), -distance);

    updateCameraProjectionForTarget(camera, 128, 128);

    const e = camera.projection.elements;
    /** NDC z of a point on the view axis, where the projection's z row reduces to `(m22 * z + m23) / -z` */
    const ndcZ = (z: number): number => (e[10] * z + e[14]) / -z;

    expect(ndcZ(-distance)).toBeCloseTo(-1, 5);
    expect(ndcZ(-camera.far)).toBeCloseTo(1, 5);
    /** The same camera without the plane, which rewrites only the z row */
    const plain = new Camera3D({ fov: 60, near: 0.1, far: 100 });
    updateCameraProjectionForTarget(plain, 128, 128);
    expect(e[0]).toBeCloseTo(plain.projection.elements[0], 5);
    expect(e[5]).toBeCloseTo(plain.projection.elements[5], 5);
  });
});

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`camera render texture (${preference})`, () => {
    it('decides winding per target, clears the feed on its first writer, and never binds the texture', async () => {
      const app = await getApp<Renderer>({
        id: `camera-render-texture-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      const display = RenderTexture.create({ width: FEED_WIDTH, height: FEED_HEIGHT, resolution: 1 });

      try {
        const { view3d, feedCamera, insetCamera } = buildScene(display);
        view3d.passes = [new FeedPass(feedCamera), new InsetPass(insetCamera)];
        app.stage.addChild(view3d);

        const renderTargetSystem = app.renderer.renderTarget;
        const original = renderTargetSystem.bind.bind(renderTargetSystem);
        /** Every target the frame binds, with its clear */
        const binds: BindOptions[] = [];
        renderTargetSystem.bind = ((options: BindOptions | Parameters<typeof original>[0]) => {
          if (typeof options === 'object' && options !== null && 'target' in options)
            binds.push(options as BindOptions);
          return original(options as Parameters<typeof original>[0]);
        }) as typeof renderTargetSystem.bind;

        app.render();

        renderTargetSystem.bind = original as typeof renderTargetSystem.bind;

        expect(
          Math.sign(getCameraData(insetCamera).projection.elements[5]),
          "pixi's winding is flipY XOR (WebGL && !isRoot), and the inset draws onto the root",
        ).toBe(1);
        expect(
          Math.sign(getCameraData(feedCamera).projection.elements[5]),
          'the feed draws into a texture, which is never the root, so WebGL flips its bound projection',
        ).toBe(preference === 'webgl' ? -1 : 1);
        expect(
          Math.sign(feedCamera.projection.elements[5]),
          "the camera's own matrix is never flipped, only the bound copy",
        ).toBe(1);

        /** A bind of the pooled target the feed draws into, which is the size of the texture's frame */
        const isFeed = (b: BindOptions): boolean =>
          b.frame instanceof Rectangle && b.frame.width === FEED_WIDTH && b.frame.height === FEED_HEIGHT;
        const feedBinds = binds.filter(isFeed);
        expect(
          feedBinds,
          'bound once: later passes on the target skip the bind, so nothing clears it twice',
        ).toHaveLength(1);
        expect(feedBinds[0].clear, "the first writer clears it through the bind's load op").toBe(CLEAR.ALL);
        expect(
          binds.some((b) => b.target instanceof RenderTarget && b.target.colorTexture.source === display.source),
          "the user's texture is only the copy's destination",
        ).toBe(false);

        const colourClears = binds.filter((b) => (Number(b.clear) & CLEAR.COLOR) !== 0);
        expect(
          colourClears,
          "the only colour clear: the view's own target carries the 2D beneath it, so the graph loads it",
        ).toEqual(feedBinds);
      } finally {
        display.destroy(true);
        app.destroy();
      }
    });

    it('sizes the feed from the texture each frame, so a resize needs no rebuild', async () => {
      const app = await getApp<Renderer>({
        id: `camera-render-texture-resize-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      const display = RenderTexture.create({ width: FEED_WIDTH, height: FEED_HEIGHT, resolution: 1 });

      try {
        const { view3d, feedCamera } = buildScene(display);
        view3d.passes = [new FeedPass(feedCamera)];
        app.stage.addChild(view3d);

        const pipe = (app.renderer as WebGLRenderer | WebGPURenderer).renderPipes.view3d;
        const copyColor = vi.spyOn(pipe, 'copyColor');

        app.render();
        expect(copyColor).toHaveBeenCalledTimes(1);
        expect(copyColor.mock.calls[0][1], 'the feed is copied into the texture, which is never bound').toBe(display);
        expect([Math.abs(feedCamera.projection.elements[5] / feedCamera.projection.elements[0])]).toEqual([
          expect.closeTo(FEED_WIDTH / FEED_HEIGHT, 4),
        ]);

        display.source.resize(256, 144);
        app.render();
        expect(copyColor).toHaveBeenCalledTimes(2);
        expect([Math.abs(feedCamera.projection.elements[5] / feedCamera.projection.elements[0])]).toEqual([
          expect.closeTo(256 / 144, 4),
        ]);
      } finally {
        display.destroy(true);
        app.destroy();
      }
    });

    for (const mips of [false, true]) {
      it(`copies the feed after its last pass${mips ? ', then generates its mipmaps' : ''}`, async () => {
        const app = await getApp<Renderer>({
          id: `camera-render-texture-copy-${mips}-${preference}`,
          appOptions: { preference, width: 128, height: 128 },
        });

        const display = RenderTexture.create({
          width: FEED_WIDTH,
          height: FEED_HEIGHT,
          resolution: 1,
          autoGenerateMipmaps: mips,
        });

        try {
          const { view3d, feedCamera, insetCamera } = buildScene(display);
          /**
           * Blended, so the feed's transparent pass has a member: a pass with none is skipped, and
           * wouldn't be the camera's last pass this frame
           */
          const pane = new Mesh3D({
            geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
            material: new Material3D({ baseColor: 0x00ff00, alpha: 0.5, alphaMode: 'blend' }),
          });
          pane.position.set(1, 0, -3);
          view3d.root.addChild(pane);
          view3d.passes = [
            new MeshPass({ name: 'opaque', camera: feedCamera }),
            new MeshPass({ name: 'transparent', camera: feedCamera, sort: 'distance' }),
            new InsetPass(insetCamera),
          ];
          app.stage.addChild(view3d);

          const pipe = (app.renderer as WebGLRenderer | WebGPURenderer).renderPipes.view3d;
          const renderForward = pipe.renderForward.bind(pipe);
          const copyColorOriginal = pipe.copyColor.bind(pipe);
          const generateMipsOriginal = pipe.generateMips.bind(pipe);
          let feedDraws = 0;
          const order: string[] = [];
          vi.spyOn(pipe, 'renderForward').mockImplementation((desc, session) => {
            if (desc.camera === feedCamera) feedDraws++;
            renderForward(desc, session);
          });
          const copyColor = vi.spyOn(pipe, 'copyColor').mockImplementation((source, dest, session) => {
            order.push(`copy after ${feedDraws} feed draws`);
            copyColorOriginal(source, dest, session);
          });
          const generateMips = vi.spyOn(pipe, 'generateMips').mockImplementation((handle, session) => {
            order.push(`mipmaps after ${feedDraws} feed draws`);
            generateMipsOriginal(handle, session);
          });

          app.render();

          const texture = view3d._graph._cameraTarget(feedCamera).texture;
          expect(copyColor).toHaveBeenCalledTimes(1);
          expect(copyColor.mock.calls[0][1]).toBe(display);
          expect(
            generateMips.mock.calls.map(([handle]) => handle),
            "only the feed's: nothing samples the view's opaque copy",
          ).toEqual(mips ? [texture] : []);
          expect(
            order,
            'once per camera after its last pass, not per pass, and the copy first so the mipmaps come from the picture',
          ).toEqual(mips ? ['copy after 2 feed draws', 'mipmaps after 2 feed draws'] : ['copy after 2 feed draws']);
        } finally {
          display.destroy(true);
          app.destroy();
        }
      });
    }

    it('copies the feed after its last colour write, when a depth copy is its last pass', async () => {
      const app = await getApp<Renderer>({
        id: `camera-render-texture-depth-copy-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      /**
       * The pool hands out textures of exactly this size for the feed's target and the depth copy,
       * so the copy covers the whole of both: WebGPU rejects a partial copy of a depth texture
       */
      const display = RenderTexture.create({ width: 128, height: 128, resolution: 1 });

      try {
        const { view3d, feedCamera } = buildScene(display);
        /**
         * Unlit, so the readback sees its colour as authored in a view with no lights; it fills the
         * feed and hides the cube from the feed camera
         */
        const wall = new Mesh3D({
          geometry: new PlaneGeometry({ width: 40, height: 40 }),
          material: new FlatMaterial({ baseColor: 0x00ff00 }),
        });
        wall.position.set(0, 0, -2);
        view3d.root.addChild(wall);
        view3d.passes = [new FeedDepthCopyPass(feedCamera)];
        app.stage.addChild(view3d);

        /**
         * The view pipe, whose WebGL depth copy this test stubs since it never reads the copy: pixi's
         * WebGL depth copy wraps the destination in a render target of its own, which destroying the
         * renderer destroys while the shared pool still holds it
         */
        const pipe = (app.renderer as WebGLRenderer | WebGPURenderer).renderPipes.view3d;
        if (preference === 'webgl') vi.spyOn(pipe, 'copyDepth').mockImplementation(() => {});

        app.render();

        const { pixels, width, height } = app.renderer.extract.pixels({ target: display });
        const i = ((height >> 1) * width + (width >> 1)) * 4;
        const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
        expect(g - r > 48 && g - b > 48, `rgb(${r}, ${g}, ${b})`).toBe(true);
      } finally {
        vi.restoreAllMocks();
        display.destroy(true);
        app.destroy();
      }
    });

    it('draws into the texture frame and takes its aspect from that rect', async () => {
      const app = await getApp<Renderer>({
        id: `camera-render-texture-frame-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      const source = new TextureSource({ width: 256, height: 256, resolution: 1 });
      const frame = new Rectangle(64, 32, FEED_WIDTH, FEED_HEIGHT);
      const display = new RenderTexture({ source, frame });

      try {
        const { view3d, feedCamera } = buildScene(display);
        view3d.passes = [new FeedPass(feedCamera)];
        app.stage.addChild(view3d);
        app.render();

        const e = feedCamera.projection.elements;
        expect(Math.abs(e[5] / e[0])).toBeCloseTo(FEED_WIDTH / FEED_HEIGHT, 4);
      } finally {
        display.destroy(true);
        app.destroy();
      }
    });

    it('rejects a render texture on the view camera', async () => {
      const app = await getApp<Renderer>({
        id: `camera-render-texture-view-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      const display = RenderTexture.create({ width: FEED_WIDTH, height: FEED_HEIGHT, resolution: 1 });

      try {
        const { view3d } = buildScene(display);
        view3d.camera.renderTexture = display;
        app.stage.addChild(view3d);
        expect(() => app.render()).toThrow(/draws the view, not a texture/);
      } finally {
        display.destroy(true);
        app.destroy();
      }
    });
  });
}

describe('MeshPass stage', () => {
  it('draws a camera with a render texture before the scene unless told otherwise', () => {
    const display = RenderTexture.create({ width: 8, height: 8 });
    const feedCamera = new Camera3D({ renderTexture: display });

    expect(new MeshPass({ name: 'opaque', camera: feedCamera }).stage).toBe('beforeOpaque');
    expect(new MeshPass({ name: 'opaque', camera: new Camera3D() }).stage).toBe('afterOpaque');
    expect(new MeshPass({ name: 'opaque' }).stage).toBe('afterOpaque');
    expect(new MeshPass({ name: 'opaque', camera: feedCamera, stage: 'afterTransparent' }).stage).toBe(
      'afterTransparent',
    );

    display.destroy(true);
  });
});
