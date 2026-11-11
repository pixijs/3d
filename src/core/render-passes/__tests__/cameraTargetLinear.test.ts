import { captureWarnings, encoded, getApp, readCanvasPixels, ScaleEffect } from '@test-utils';
import { RenderTexture, Sprite } from 'pixi.js';
import type { Application, BindGroup, Renderer, Shader, TEXTURE_FORMATS, WebGLRenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { RenderGraph } from '~/core/render-graph/RenderGraph';
import { CopyOpaquePass } from '~/core/render-passes/copy-opaque/CopyOpaquePass';
import { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { TransmissionRenderPass } from '~/core/render-passes/transmission/TransmissionRenderPass';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import type { PostEffect } from '~/post-processing/effects/PostEffect';
import { Pass3D } from '~/post-processing/Pass3D';
import type { PassContext, SceneStage } from '~/post-processing/Pass3D';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;
const FEED = 32;

interface OutputDrawProbe {
  _colorOutputDraw: { _bindGroup: BindGroup; _shaders: Map<unknown, Shader> } | null;
}

class FeedPass extends Pass3D {
  public readonly stage: SceneStage = 'beforeOpaque';

  constructor(
    private readonly _camera: Camera3D,
    private readonly _copyItsColour = false,
  ) {
    super();
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    const { renderer } = ctx;
    const camera = this._camera;
    graph.addPass(new ForwardRenderPass({ renderer, name: 'opaque', sort: 'key', camera }));
    if (!this._copyItsColour) return;
    const opaqueColorHandle = graph.createColor({ autoGenerateMipmaps: true, label: 'feedOpaqueColor' });
    graph.addPass(new CopyOpaquePass({ renderer, camera, opaqueColorHandle }));
    graph.addPass(new TransmissionRenderPass({ renderer, camera, opaqueColorHandle }));
  }
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`camera render textures in a linear view (${preference})`, () => {
    async function withFeed(
      id: string,
      options: { format?: TEXTURE_FORMATS; antialias?: boolean; copyItsColour?: boolean; tint?: number },
      run: (app: Application<Renderer>, view3d: View3D, effect: PostEffect) => void,
    ): Promise<void> {
      const app = await getApp<Renderer>({
        id: `${id}-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x000000 },
      });
      const feed = RenderTexture.create({
        width: FEED,
        height: FEED,
        antialias: options.antialias ?? false,
        ...(options.format ? { format: options.format } : {}),
      });
      const camera = new Camera3D({ renderTexture: feed });
      camera.position.set(0, 0, 2);
      const view3d = new View3D({ width: SIZE, height: SIZE / 2 });
      view3d.root.addChild(
        new Mesh3D({
          geometry: new PlaneGeometry({ width: 40, height: 40 }),
          material: new Material3D({ baseColor: 0xffffff, metallic: 0, roughness: 1 }),
        }),
        new AmbientLight({ intensity: Math.PI }),
        camera,
      );
      if (options.copyItsColour) {
        const glass = new Mesh3D({
          geometry: new PlaneGeometry({ width: 0.5, height: 0.5 }),
          material: new Material3D({ baseColor: 0xffffff, roughness: 0, transmission: { factor: 1 } }),
        });
        glass.position.set(0, 0, 1);
        view3d.root.addChild(glass);
      }
      view3d.camera.position.set(0, 0, 2);
      const effect = new ScaleEffect();
      view3d.passes = [new FeedPass(camera, options.copyItsColour)];
      const sprite = new Sprite(feed);
      sprite.y = SIZE / 2;
      if (options.tint !== undefined) sprite.tint = options.tint;
      app.stage.addChild(view3d, sprite);
      try {
        run(app, view3d, effect);
      } finally {
        view3d.destroy({ children: true, geometry: true, material: true });
        sprite.destroy();
        feed.destroy(true);
        app.destroy();
      }
    }

    const shownFeed = (app: Application<Renderer>): number =>
      readCanvasPixels(app.canvas, FEED / 2, SIZE / 2 + FEED / 2, 1, 1)[0];

    it('fills an 8-bit render texture with the same finished picture in either mode', async () => {
      await withFeed('camera-linear-8bit', {}, (app, view3d, effect) => {
        view3d.toneMapping = 'reinhard';
        view3d.exposure = 2;
        app.render();
        const curveInShaders = shownFeed(app);

        view3d.passes = [...view3d.passes, effect];
        app.render();
        expect(curveInShaders, 'Reinhard maps radiance 2 to 2/3').toBeCloseTo(encoded(2 / 3), -1);
        expect(shownFeed(app), 'the camera draws in float, and the output draw applies the curve once').toBeCloseTo(
          curveInShaders,
          -1,
        );
      });
    });

    it('resolves an antialiased 8-bit render texture it draws into', async () => {
      await withFeed('camera-linear-msaa', { antialias: true }, (app, view3d, effect) => {
        view3d.toneMapping = 'reinhard';
        view3d.exposure = 2;
        view3d.passes = [...view3d.passes, effect];
        app.render();
        expect(shownFeed(app), 'the multisampled picture reaches the texture').toBeCloseTo(encoded(2 / 3), -1);
      });
    });

    it('keeps light above 1 in a float render texture', async () => {
      await withFeed('camera-linear-float', { format: 'rgba16float', tint: 0x808080 }, (app, view3d, effect) => {
        view3d.toneMapping = 'none';
        view3d.exposure = 2;
        view3d.passes = [...view3d.passes, effect];
        app.render();
        expect(
          shownFeed(app),
          'radiance 2 halved by the tint is 1, where a clipped texture would give half',
        ).toBeGreaterThan(250);
      });
    });

    it("lets a camera pass copy its own colour into a texture that takes the scene's format", async () => {
      await withFeed('camera-linear-own-copy', { copyItsColour: true }, (app, view3d, effect) => {
        view3d.toneMapping = 'reinhard';
        view3d.exposure = 2;
        view3d.passes = [...view3d.passes, effect];
        const glError = (): number => (preference === 'webgl' ? (app.renderer as WebGLRenderer).gl.getError() : 0);
        while (glError());
        app.render();
        expect(glError(), "WebGL accepts the copy of the camera's colour").toBe(0);
        const besideTheGlass = readCanvasPixels(app.canvas, 2, SIZE / 2 + 2, 1, 1)[0];
        expect(besideTheGlass, 'the frame draws, and the feed holds the curved picture').toBeCloseTo(
          encoded(2 / 3),
          -1,
        );
      });
    });

    it('releases its output draw with the renderer', async () => {
      const app = await getApp<Renderer>({
        id: `camera-linear-release-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, resolution: 1 },
      });
      const feed = RenderTexture.create({ width: FEED, height: FEED });
      const camera = new Camera3D({ renderTexture: feed });
      const view3d = new View3D({ width: SIZE, height: SIZE });
      view3d.root.addChild(new Mesh3D({ geometry: new PlaneGeometry(), material: new Material3D() }), camera);
      view3d.passes = [new FeedPass(camera), new ScaleEffect()];
      app.stage.addChild(view3d);
      app.render();

      const draw = (app.renderer.renderPipes as unknown as Record<string, OutputDrawProbe>).view3d._colorOutputDraw!;
      const shaders = [...draw._shaders.values()];
      expect(shaders.length, 'the 8-bit feed went through the output draw').toBe(1);
      view3d.destroy({ children: true, geometry: true, material: true });
      feed.destroy(true);

      const warnings = captureWarnings(() => app.destroy());
      expect(warnings.filter((text) => text.includes('[BindGroup]'))).toEqual([]);
      expect(draw._bindGroup.resources).toBeNull();
      for (const shader of shaders) expect(shader.groups).toBeNull();
    });
  });
}
