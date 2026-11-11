import { getApp, renderFrame } from '@test-utils';
import { AlphaFilter, Container, Texture } from 'pixi.js';
import type { Application, Renderer } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';

import { getCameraData } from '~/core/CameraData';
import type { PassBuilder } from '~/core/render-graph/PassBuilder';
import type { RenderGraph } from '~/core/render-graph/RenderGraph';
import type { ColorHandle, ResourceHandle } from '~/core/render-graph/ResourceHandle';
import { DepthClearPass } from '~/core/render-passes/depth-clear/DepthClearPass';
import { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import type { RenderSession } from '~/core/render-passes/RenderSession';
import { MotionBlurEffect } from '~/extras/post-processing/effects/MotionBlurEffect';
import { SsaoEffect } from '~/extras/post-processing/effects/SsaoEffect';
import { TiltShiftEffect } from '~/extras/post-processing/effects/TiltShiftEffect';
import { TintEffect } from '~/extras/post-processing/effects/TintEffect';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { FullscreenPass } from '~/post-processing/effects/FullscreenPass';
import { PostEffect } from '~/post-processing/effects/PostEffect';
import type { EffectIO } from '~/post-processing/effects/PostEffect';
import { Pass3D } from '~/post-processing/Pass3D';
import type { PassContext } from '~/post-processing/Pass3D';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { createDefaultGraph3D } from '~/scene/utils/createDefaultGraph3D';
import { View3D } from '~/scene/View3D';

const SIZE = 48;
const DPR = 2;
const PHYSICAL = SIZE * DPR;
const SCENE_RESOLUTION = 1.5;
const SCENE = SIZE * SCENE_RESOLUTION;
const BLUR_SIZE = 128;

class SizeProbe {
  public readonly name = 'sizeProbe';
  public readonly sizes: Record<string, [number, number]> = {};
  private readonly _handles: Record<string, ResourceHandle>;

  constructor(
    reads: Record<string, ResourceHandle>,
    private readonly _own: ColorHandle,
  ) {
    this._handles = { ...reads, own: _own };
  }

  public setup(b: PassBuilder): void {
    for (const handle of Object.values(this._handles)) if (handle !== this._own) b.read(handle);
    b.writeColor(this._own);
    b.sideEffect();
  }

  public render(session: RenderSession): void {
    for (const [name, handle] of Object.entries(this._handles)) {
      const { frame, source } = session.view3d._graph.getTexture(handle, session);
      this.sizes[name] = [Math.round(frame.width * source.resolution), Math.round(frame.height * source.resolution)];
    }
  }
}

class ProbeSceneTextures extends Pass3D {
  public readonly stage = 'afterTransparent';
  public probe: SizeProbe | null = null;

  public build(graph: RenderGraph, ctx: PassContext): void {
    this.probe = graph.addPass(
      new SizeProbe(
        {
          sceneColor: graph.sceneColor,
          sceneDepth: graph.sceneDepth,
          opaqueColor: ctx.opaqueColor,
          opaqueDepth: ctx.opaqueDepth,
        },
        graph.createColor({ label: 'probeOwn' }),
      ),
    );
  }
}

class InsetPass extends Pass3D {
  public readonly stage = 'afterTransparent';

  constructor(private readonly _camera: Camera3D) {
    super();
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    graph.addPass(new DepthClearPass({ renderer: ctx.renderer, camera: this._camera }));
    graph.addPass(new ForwardRenderPass({ renderer: ctx.renderer, name: 'opaque', sort: 'key', camera: this._camera }));
  }
}

class DepthCoverage extends PostEffect {
  constructor(private readonly _rightEdge = false) {
    super({ stage: 'afterToneMapping' });
  }

  public override build(graph: RenderGraph, io: EffectIO): void {
    const gpuUv = this._rightEdge ? 'vec2<f32>(1.0, uv.y)' : 'uv';
    const glUv = this._rightEdge ? 'vec2(1.0, uv.y)' : 'uv';
    graph.addPass(
      new FullscreenPass({
        renderer: io.renderer,
        label: 'depthCoverage',
        fragment: {
          gpu: `fn effect(uv: vec2<f32>) -> vec4<f32> { let c = select(0.0, 1.0, sampleDepth(${gpuUv}) < 0.999); return vec4<f32>(c, c, c, 1.0); }`,
          gl: `vec4 effect(vec2 uv) { float c = sampleDepth(${glUv}) < 0.999 ? 1.0 : 0.0; return vec4(c, c, c, 1.0); }`,
        },
        reads: { depth: graph.sceneDepth },
        writes: io.output,
      }),
    );
  }
}

function gridTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#000000';
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = '#19e6ff';
  context.lineWidth = 6;
  for (let i = 0; i <= 256; i += 32) {
    context.beginPath();
    context.moveTo(i, 0);
    context.lineTo(i, 256);
    context.moveTo(0, i);
    context.lineTo(256, i);
    context.stroke();
  }
  return Texture.from(canvas);
}

function gridWall(grid: Texture): Mesh3D {
  const wall = new Mesh3D({
    geometry: new PlaneGeometry({ width: 8, height: 8 }),
    material: new Material3D({ baseColor: 0x000000, emissive: { color: 0xffffff, texture: grid } }),
  });
  wall.position.set(0, 0, -1.5);
  return wall;
}

function meanDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) if (i % 4 !== 3) sum += Math.abs(a[i] - b[i]);
  return sum / ((a.length * 3) / 4) / 255;
}

function blurredColumns(pixels: Uint8ClampedArray): number {
  const physical = BLUR_SIZE * DPR;
  let columns = 0;
  for (let x = 0; x < physical; x++) {
    const red = pixels[((physical / 2) * physical + x) * 4];
    if (red > 6 && red < 249) columns++;
  }
  return columns;
}

function leftHalfQuad(): Mesh3D {
  const quad = new Mesh3D({
    geometry: new PlaneGeometry({ width: 20, height: 60 }),
    material: new FlatMaterial({ doubleSided: true }),
  });
  quad.position.set(-10, 0, 0);
  return quad;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`View3D.resolution (${preference})`, () => {
    let app: Application<Renderer>;
    let view3d: View3D;

    async function setup(
      id: string,
      options: ConstructorParameters<typeof View3D>[0] = {},
      size = SIZE,
    ): Promise<void> {
      app = await getApp<Renderer>({
        id: `view-resolution-${id}-${preference}`,
        appOptions: {
          preference,
          width: size,
          height: size,
          resolution: DPR,
          backgroundColor: 0x0000ff,
          autoStart: false,
          useBackBuffer: true,
        },
      });
      expect(app.renderer.name).toBe(preference);
      view3d = new View3D({ width: size, height: size, toneMapping: 'none', ...options });
      view3d.camera.fov = 40;
      view3d.camera.position.set(0, 0, 4);
      view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
      app.stage.addChild(view3d);
    }

    async function scaledAgainstFull(sceneResolution = SCENE_RESOLUTION): Promise<number> {
      view3d.resolution = DPR;
      const full = await renderFrame(app);
      const graph = view3d._graph;
      view3d.resolution = sceneResolution;
      const scaled = await renderFrame(app);
      expect(view3d._graph, 'a number to number change keeps the graph').toBe(graph);
      expect(
        getCameraData(view3d.camera).viewportUvScale.x,
        'the scene fills part of its pooled texture, so a wrong UV scale would show',
      ).not.toBe(1);
      return meanDifference(full, scaled);
    }

    afterEach(() => {
      view3d?.destroy(true);
      app?.destroy();
    });

    it("sizes the scene textures, the opaque copies and a pass's own texture at the view's resolution, live", async () => {
      const probe = new ProbeSceneTextures();
      await setup('sizes', { resolution: SCENE_RESOLUTION, passes: [probe] });
      view3d.root.addChild(new AmbientLight({ intensity: 1 }), gridWall(gridTexture()));

      await renderFrame(app);
      const scene = [SCENE, SCENE];
      expect(probe.probe!.sizes).toEqual({
        sceneColor: scene,
        sceneDepth: scene,
        opaqueColor: scene,
        opaqueDepth: scene,
        own: scene,
      });

      const graph = view3d._graph;
      view3d.resolution = 1;
      await renderFrame(app);
      expect(view3d._graph, 'changing the number rebuilds nothing').toBe(graph);
      expect(probe.probe!.sizes.sceneColor).toEqual([SIZE, SIZE]);
      expect(probe.probe!.sizes.opaqueDepth).toEqual([SIZE, SIZE]);
      expect(probe.probe!.sizes.own, "a pass's own texture inherits the scene too").toEqual([SIZE, SIZE]);
    });

    it('covers the whole view, and stretches the edges without reading past the scene', async () => {
      await setup('edges', { resolution: SCENE_RESOLUTION });
      const material = new FlatMaterial({ baseColor: 0xff0000 });
      view3d.root.addChild(new Mesh3D({ geometry: new PlaneGeometry({ width: 20, height: 20 }), material }));
      const pixels = await renderFrame(app);

      const wrong: string[] = [];
      for (let y = 0; y < PHYSICAL; y++) {
        for (let x = 0; x < PHYSICAL; x++) {
          const i = (y * PHYSICAL + x) * 4;
          if (pixels[i] < 250 || pixels[i + 1] > 4 || pixels[i + 2] > 4) {
            wrong.push(`${x}, ${y}: ${pixels[i]}, ${pixels[i + 1]}, ${pixels[i + 2]}`);
          }
        }
      }
      expect(
        wrong.slice(0, 8),
        `${wrong.length} pixels aren't the scene's red: a tap past the scene blends in the clear colour`,
      ).toEqual([]);
    });

    it("composites only while the scene's resolution differs from the target's", async () => {
      await setup('rebuild');
      await renderFrame(app);
      const direct = view3d._graph;
      expect(direct.sceneColor, "'inherit' draws straight to the screen").toBe(direct.defaultColor);

      view3d.resolution = DPR;
      await renderFrame(app);
      expect(view3d._graph, "the target's own resolution still draws straight to it").toBe(direct);

      view3d.resolution = 1;
      await renderFrame(app);
      const composited = view3d._graph;
      expect(composited).not.toBe(direct);
      expect(composited.sceneColor, 'a smaller scene composites').not.toBe(composited.defaultColor);

      view3d.resolution = 0.5;
      await renderFrame(app);
      view3d.resolution = 1.25;
      await renderFrame(app);
      expect(view3d._graph).toBe(composited);

      view3d.resolution = 'inherit';
      await renderFrame(app);
      expect(view3d._graph).not.toBe(composited);
      expect(view3d._graph.sceneColor).toBe(view3d._graph.defaultColor);
    });

    it('keeps the graph across inherit when the view composites anyway', async () => {
      await setup('rebuild-composite', { composite: true });
      await renderFrame(app);
      const graph = view3d._graph;
      view3d.resolution = 1;
      await renderFrame(app);
      view3d.resolution = 'inherit';
      await renderFrame(app);
      expect(view3d._graph, 'composite: true').toBe(graph);

      view3d.destroy(true);
      app.destroy();
      await setup('rebuild-effect', { passes: [new DepthCoverage()] });
      await renderFrame(app);
      const withEffect = view3d._graph;
      view3d.resolution = 1;
      await renderFrame(app);
      expect(view3d._graph, 'a post effect already composites').toBe(withEffect);
      view3d.resolution = 'inherit';
      await renderFrame(app);
      expect(view3d._graph, 'stepping back to native').toBe(withEffect);
      view3d.resolution = 1;
      await renderFrame(app);
      view3d.resolution = 'inherit';
      await renderFrame(app);
      expect(view3d._graph, 'a second step down and back').toBe(withEffect);
    });

    it('lines glass up with the opaque copy it refracts', async () => {
      await setup('glass', { composite: true });
      view3d.root.addChild(new AmbientLight({ intensity: 1 }), gridWall(gridTexture()));
      const glass = new Mesh3D({
        geometry: new CubeGeometry({ width: 1.7, height: 1.7, depth: 1.7 }),
        material: new Material3D({
          baseColor: 0xffffff,
          metallic: 0,
          roughness: 0.04,
          transmission: { factor: 1, thickness: 0.6 },
          ior: 1.5,
        }),
      });
      glass.rotation.set(-0.35, 0.6, 0);
      view3d.root.addChild(glass);

      expect(await scaledAgainstFull()).toBeLessThan(0.12);
    });

    it('places an inset camera in the scene texture', async () => {
      const inset = new Camera3D({ mode: 'orthographic', orthographicSize: 4, near: 0.1, far: 20 });
      inset.position.set(0, 0, 6);
      inset.viewport.x = 0.5;
      inset.viewport.y = 0;
      inset.viewport.width = 0.5;
      inset.viewport.height = 0.5;
      await setup('inset', { composite: true, passes: [new InsetPass(inset)] });
      view3d.root.addChild(new AmbientLight({ intensity: 1 }), gridWall(gridTexture()), inset);

      expect(await scaledAgainstFull()).toBeLessThan(0.12);
    });

    it('puts a depth edge on the same screen pixel at half resolution, in an effect', async () => {
      await setup('depth-edge', { passes: [new DepthCoverage()] });
      view3d.camera.useOrthographic(10, 0.1, 100);
      view3d.camera.position.set(0, 0, 10);
      const quad = new Mesh3D({
        geometry: new PlaneGeometry({ width: 20, height: 40 }),
        material: new FlatMaterial({ doubleSided: true }),
      });
      quad.position.set(-15, 0, 0);
      view3d.root.addChild(quad);

      const coveredColumns = (pixels: Uint8ClampedArray): number => {
        let columns = 0;
        for (let x = 0; x < PHYSICAL; x++) if (pixels[((PHYSICAL / 2) * PHYSICAL + x) * 4] > 128) columns++;
        return columns;
      };

      view3d.resolution = DPR;
      expect(coveredColumns(await renderFrame(app)), 'the quad covers the left quarter').toBe(PHYSICAL / 4);
      view3d.resolution = 1;
      expect(coveredColumns(await renderFrame(app)), 'two screen pixels per depth texel, same edge').toBe(PHYSICAL / 4);
    });

    it("reads the scene's last depth texel for a tap at the edge, not the texture past it", async () => {
      await setup('depth-right-edge', { resolution: SCENE_RESOLUTION, passes: [new DepthCoverage(true)] });
      view3d.root.addChild(
        new Mesh3D({ geometry: new PlaneGeometry({ width: 20, height: 20 }), material: new FlatMaterial() }),
      );
      const pixels = await renderFrame(app);

      expect(getCameraData(view3d.camera).viewportUvScale.x, 'the scene leaves padding to its right').not.toBe(1);
      expect(pixels[((PHYSICAL / 2) * PHYSICAL + PHYSICAL / 2) * 4], 'the surface reaches the edge').toBeGreaterThan(
        128,
      );
    });

    it('rebuilds smooth normals from depth in SSAO when its buffer is finer than the scene', async () => {
      await setup('ssao', { passes: [new SsaoEffect({ resolution: DPR, intensity: 2 })] });
      const white = new FlatMaterial({ baseColor: 0xffffff });
      const floor = new Mesh3D({ geometry: new PlaneGeometry({ width: 8, height: 8 }), material: white });
      floor.rotation.set(-1.2, 0, 0);
      floor.position.set(0, -0.5, 0);
      const box = new Mesh3D({ geometry: new CubeGeometry(), material: white });
      box.rotation.set(0.5, 0.7, 0);
      view3d.root.addChild(floor, box);

      expect(
        await scaledAgainstFull(1.25),
        'taps on the centre texel give flat normals and measure about 0.013; a depth-texel step about 0.004',
      ).toBeLessThan(0.0075);
    });

    for (const followed of [false, true]) {
      it(`keeps tilt-shift's blur the same width on screen at half resolution, ${followed ? 'with an effect after it' : 'as the last effect'}`, async () => {
        const tiltShift = new TiltShiftEffect({ focalDepth: 1000, focalNear: 0, focalFar: 1, maxBlur: 16 });
        await setup(
          `tilt-width-${followed}`,
          { passes: followed ? [tiltShift, new TintEffect({ tint: 0xffffff })] : [tiltShift] },
          BLUR_SIZE,
        );
        view3d.camera.useOrthographic(10, 0.1, 100);
        view3d.camera.position.set(0, 0, 10);
        view3d.root.addChild(leftHalfQuad());

        view3d.resolution = DPR;
        const full = blurredColumns(await renderFrame(app));
        view3d.resolution = 1;
        const half = blurredColumns(await renderFrame(app));

        expect(full, 'the blur spreads the edge').toBeGreaterThan(20);
        expect(Math.abs(half - full), `${full} columns at full resolution, ${half} at half`).toBeLessThanOrEqual(4);
      });
    }

    it("caps a motion blur streak in the view's pixels, with an effect after it", async () => {
      const motionBlur = new MotionBlurEffect({ intensity: 1, samples: 16, maxLength: 16 });
      await setup('motion-cap', { passes: [motionBlur, new TintEffect({ tint: 0xffffff })] }, BLUR_SIZE);
      view3d.camera.useOrthographic(10, 0.1, 100);
      const backdrop = new Mesh3D({
        geometry: new PlaneGeometry({ width: 200, height: 200 }),
        material: new FlatMaterial({ doubleSided: true, baseColor: 0x000000 }),
      });
      backdrop.position.set(0, 0, -1);
      view3d.root.addChild(backdrop, leftHalfQuad());

      const streak = async (resolution: number): Promise<number> => {
        view3d.resolution = resolution;
        view3d.camera.position.set(0, 0, 10);
        await renderFrame(app);
        view3d.camera.position.set(5, 0, 10);
        return blurredColumns(await renderFrame(app));
      };
      const full = await streak(DPR);

      expect(full, 'the pan outruns the cap, so the streak is the cap').toBeGreaterThan(10);
      const half = await streak(1);
      expect(Math.abs(half - full), `${full} columns at full resolution, ${half} at half`).toBeLessThanOrEqual(4);
    });

    it("compares with its target's resolution under a filter, not the renderer's", async () => {
      let composite: boolean | undefined;
      await setup('filter-target', {
        resolution: 1,
        graph: (renderer, options) => {
          composite = options.composite;
          return createDefaultGraph3D(renderer, options).graph;
        },
      });
      const filtered = new Container();
      filtered.filters = [new AlphaFilter({ alpha: 1, resolution: 1 })];
      filtered.addChild(view3d);
      app.stage.addChild(filtered);

      view3d.camera.useOrthographic(10, 0.1, 100);
      view3d.camera.position.set(0, 0, 10);
      const topLeft = new Mesh3D({
        geometry: new PlaneGeometry({ width: 20, height: 20 }),
        material: new FlatMaterial({ doubleSided: true, baseColor: 0xff0000 }),
      });
      topLeft.position.set(-10, 10, 0);
      view3d.root.addChild(topLeft);

      const redAt = (pixels: Uint8ClampedArray): boolean[] =>
        [
          [1, 1],
          [3, 1],
          [1, 3],
          [3, 3],
        ].map(([x, y]) => pixels[((y * PHYSICAL) / 4) * PHYSICAL * 4 + ((x * PHYSICAL) / 4) * 4] > 128);

      expect(redAt(await renderFrame(app)), 'upright, drawn straight to the filter texture').toEqual([
        true,
        false,
        false,
        false,
      ]);
      expect(composite, "1 is the filter texture's resolution, though the renderer's is 2").toBe(false);

      view3d.resolution = 2;
      expect(redAt(await renderFrame(app)), 'upright, through a scene texture').toEqual([true, false, false, false]);
      expect(composite, "2 differs from the filter texture's").toBe(true);
    });
  });
}
