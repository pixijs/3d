import { getApp } from '@test-utils';
import { CLEAR, Rectangle, RenderTarget, RenderTexture, TextureSource } from 'pixi.js';
import type { BindOptions, Renderer, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { getCameraData } from '~/core/CameraData';
import { updateCameraProjectionForTarget } from '~/core/prepareCamera';
import type { RenderGraph } from '~/core/render-graph/RenderGraph';
import { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Plane } from '~/math/shapes/Plane';
import { Vector3 } from '~/math/vector/Vector3';
import { Pass3D } from '~/post-processing/Pass3D';
import type { PassContext, PassStage } from '~/post-processing/Pass3D';
import { MeshPass } from '~/post-processing/passes/MeshPass';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * A camera with a render texture: the projection built for that texture, the winding
 * decided for it, the clear the graph gives its first writer, and a draw that lands in the texture.
 */

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
  it('takes its aspect from the rect the camera fills, not from the view', () => {
    const camera = new Camera3D({ fov: 60 });
    const frame = updateCameraProjectionForTarget(camera, FEED_WIDTH, FEED_HEIGHT);

    expect(frame).toBeDefined();
    expect([frame!.x, frame!.y, frame!.width, frame!.height]).toEqual([0, 0, FEED_WIDTH, FEED_HEIGHT]);

    // f = 1 / tan(fov / 2); the x scale is f / aspect and the y scale is f.
    const f = 1 / Math.tan(Math.PI / 6);
    const e = camera.projection.elements;
    expect(e[0]).toBeCloseTo(f / (FEED_WIDTH / FEED_HEIGHT), 5);
    expect(e[5]).toBeCloseTo(f, 5);
    // Nothing was clipped, so from and to match.
    expect(e[8]).toBeCloseTo(0, 6);
    expect(e[9]).toBeCloseTo(0, 6);
  });

  it('maps the projection when the camera viewport runs off the target', () => {
    const camera = new Camera3D({ fov: 60 });
    // The right half of the texture, pushed a quarter of its own width past the edge.
    camera.viewport.x = 0.75;
    camera.viewport.width = 0.5;

    const frame = updateCameraProjectionForTarget(camera, FEED_WIDTH, FEED_HEIGHT)!;

    // Asked for 96..192 of a 128-wide texture; 96..128 is what is left.
    expect([frame.x, frame.y, frame.width, frame.height]).toEqual([96, 0, 32, FEED_HEIGHT]);

    const f = 1 / Math.tan(Math.PI / 6);
    const unclippedAspect = (FEED_WIDTH * 0.5) / FEED_HEIGHT;
    const e = camera.projection.elements;
    // The aspect is still the unclipped rect's; the visible half of it is zoomed into.
    expect(e[0]).toBeCloseTo((f / unclippedAspect) * 2, 5);
    expect(e[5]).toBeCloseTo(f, 5);
    // Offset = how far the visible centre sits from the intended one, in half-widths of what is
    // left: the visible 96..128 is centred at 112, the intended 96..192 at 128.
    expect(e[8]).toBeCloseTo(-1, 5);
  });

  it('reports no frame when the camera lands entirely off the target', () => {
    const camera = new Camera3D();
    camera.viewport.x = 1.4;

    expect(updateCameraProjectionForTarget(camera, FEED_WIDTH, FEED_HEIGHT)).toBeUndefined();
  });

  it('makes the clipping plane the near plane and the far corner the far plane', () => {
    // A plane 5 units in front of the camera, facing away from it: kept is `-z - 5 >= 0`, so
    // everything beyond 5 units. The oblique construction has to land that plane exactly on the
    // clip volume's near face and leave the far corner on its far face.
    const distance = 5;
    const camera = new Camera3D({ fov: 60, near: 0.1, far: 100 });
    camera.clippingPlane = new Plane(new Vector3(0, 0, -1), -distance);

    updateCameraProjectionForTarget(camera, 128, 128);

    // On the view axis the projection's Z row reduces to `(m22 * z + m23) / -z`.
    const e = camera.projection.elements;
    const ndcZ = (z: number): number => (e[10] * z + e[14]) / -z;

    expect(ndcZ(-distance)).toBeCloseTo(-1, 5);
    expect(ndcZ(-camera.far)).toBeCloseTo(1, 5);
    // The plane rewrites the Z row and leaves the X/Y scales alone.
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

        // Record what the graph binds and with what clear.
        const renderTargetSystem = app.renderer.renderTarget;
        const original = renderTargetSystem.bind.bind(renderTargetSystem);
        const binds: BindOptions[] = [];
        renderTargetSystem.bind = ((options: BindOptions | Parameters<typeof original>[0]) => {
          if (typeof options === 'object' && options !== null && 'target' in options)
            binds.push(options as BindOptions);
          return original(options as Parameters<typeof original>[0]);
        }) as typeof renderTargetSystem.bind;

        app.render();

        renderTargetSystem.bind = original as typeof renderTargetSystem.bind;

        // --- Winding ---
        // Pixi resolves winding as `flipY XOR (isWebGL && !isRoot)`. Both cameras are prepared
        // against the same binding — the canvas, `flipY` false — so only `isRoot` differs: the
        // inset draws onto the root and the feed into a texture, which is never root. A negative
        // Y scale is the flip; the projections are otherwise built the same way.
        expect(Math.sign(getCameraData(insetCamera).projection.elements[5])).toBe(1);
        expect(Math.sign(getCameraData(feedCamera).projection.elements[5])).toBe(preference === 'webgl' ? -1 : 1);
        // The cameras' own matrices are never flipped; only the bound copy is.
        expect(Math.sign(feedCamera.projection.elements[5])).toBe(1);

        // --- Clears ---
        // The feed is a pooled transient the size of the texture's frame, so its first writer
        // clears colour and depth through the bind's load op — a feed needs no clear pass of its
        // own. Bound once: later passes on that target skip the bind, so nothing can clear it
        // twice. The user's texture itself is never bound: it is the copy's destination only.
        const isFeed = (b: BindOptions): boolean =>
          b.frame instanceof Rectangle && b.frame.width === FEED_WIDTH && b.frame.height === FEED_HEIGHT;
        const feedBinds = binds.filter(isFeed);
        expect(feedBinds).toHaveLength(1);
        expect(feedBinds[0].clear).toBe(CLEAR.ALL);
        expect(
          binds.some((b) => b.target instanceof RenderTarget && b.target.colorTexture.source === display.source),
        ).toBe(false);

        // And it is the only colour clear in the frame: the view's own target carries the 2D
        // beneath it, so the graph loads it and composites on top.
        const colourClears = binds.filter((b) => (Number(b.clear) & CLEAR.COLOR) !== 0);
        expect(colourClears).toEqual(feedBinds);
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
        // The feed lands in the frame of a target it never bound: the texture's own pixels.
        expect(copyColor).toHaveBeenCalledTimes(1);
        expect(copyColor.mock.calls[0][0]).toBe(view3d._graph._cameraTarget(feedCamera).texture);
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
          // A blended mesh so the transparent pass has members — a pass with none is culled and
          // would not be the camera's last pass this frame.
          const pane = new Mesh3D({
            geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
            material: new Material3D({ baseColor: 0x00ff00, alpha: 0.5, alphaMode: 'blend' }),
          });
          pane.position.set(1, 0, -3);
          view3d.root.addChild(pane);
          // Two passes on the feed camera: the copy and the mipmaps are the camera's, so each
          // happens once, after the second of them — not once per pass, and not after the first
          // over a half-drawn picture.
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
          const copyColor = vi.spyOn(pipe, 'copyColor').mockImplementation((handle, session) => {
            order.push(`copy after ${feedDraws} feed draws`);
            copyColorOriginal(handle, session);
          });
          const generateMips = vi.spyOn(pipe, 'generateMips').mockImplementation((handle, session) => {
            order.push(`mipmaps after ${feedDraws} feed draws`);
            generateMipsOriginal(handle, session);
          });

          app.render();

          // No pass carries either step; the graph does both after the feed's last writer, the
          // copy first so the mipmaps come from the picture. (The opaque copy gets no mipmaps
          // here: nothing samples it.)
          const texture = view3d._graph._cameraTarget(feedCamera).texture;
          expect(copyColor.mock.calls.map(([handle]) => handle)).toEqual([texture]);
          expect(generateMips.mock.calls.map(([handle]) => handle)).toEqual(mips ? [texture] : []);
          expect(order).toEqual(
            mips ? ['copy after 2 feed draws', 'mipmaps after 2 feed draws'] : ['copy after 2 feed draws'],
          );
        } finally {
          display.destroy(true);
          app.destroy();
        }
      });
    }

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
