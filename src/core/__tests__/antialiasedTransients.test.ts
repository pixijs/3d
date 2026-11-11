import { expectCleanRender, getApp, readCanvasPixels, renderFrame } from '@test-utils';
import { RendererType, RenderTexture, TexturePool } from 'pixi.js';
import type { Application, Renderer, Texture, WebGPURenderer } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RenderGraph } from '~/core/render-graph/RenderGraph';
import type { SceneOutput } from '~/core/render-graph/SceneOutput';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import { MotionBlurEffect } from '~/extras/post-processing/effects/MotionBlurEffect';
import { SsaoEffect } from '~/extras/post-processing/effects/SsaoEffect';
import { TiltShiftEffect } from '~/extras/post-processing/effects/TiltShiftEffect';
import { TintEffect } from '~/extras/post-processing/effects/TintEffect';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { FullscreenPass } from '~/post-processing/effects/FullscreenPass';
import type { EffectFragment } from '~/post-processing/effects/PostEffect';
import { Pass3D } from '~/post-processing/Pass3D';
import type { PassContext, PassStage } from '~/post-processing/Pass3D';
import { MeshPass } from '~/post-processing/passes/MeshPass';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';
import type { View3DOptions } from '~/scene/View3D';

const WIDTH = 200;
const HEIGHT = 160;

interface PoolRequest {
  label?: string;
  antialias?: boolean;
  autoGenerateMipmaps?: boolean;
}

function poolCalls(spy: ReturnType<typeof vi.spyOn>): PoolRequest[] {
  return (spy.mock.calls as [PoolRequest][]).map(([options]) => options);
}

function antialiasByLabel(spy: ReturnType<typeof vi.spyOn>): Map<string, boolean> {
  const requests = new Map<string, boolean>();
  for (const options of poolCalls(spy)) {
    if (options.label) requests.set(options.label, options.antialias === true);
  }
  return requests;
}

function scene(options: Partial<View3DOptions>): View3D {
  const view = new View3D({ width: WIDTH, height: HEIGHT, ...options });
  view.camera.position.z = 4;
  view.camera.lookAt({ x: 0, y: 0, z: 0 });
  view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 1 }));
  const cube = new Mesh3D({
    geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 }),
    material: new Material3D({ baseColor: 0xffffff, roughness: 1 }),
  });
  view.root.addChild(cube);
  const glass = new Mesh3D({
    geometry: new CubeGeometry({ width: 0.8, height: 0.8, depth: 0.2 }),
    material: new Material3D({ transmission: { factor: 1, thickness: 0.5 }, ior: 1.5, roughness: 0.6 }),
  });
  glass.position.set(1.4, 0, 1);
  view.root.addChild(glass);
  return view;
}

class RequireOutput extends Pass3D {
  public readonly stage: PassStage = 'afterTransparent';
  public readonly requiredOutputs: readonly SceneOutput[];

  constructor(output: SceneOutput) {
    super();
    this.requiredOutputs = [output];
  }

  public build(): void {}
}

const coverageBit: ShaderBit = {
  name: 'testAntialiasCoverage',
  outputs: { coverage: 'f32' },
  gpu: { fragment: { end: 'outputs.coverage = 1.0;' } },
  gl: { fragment: { end: 'outputs.coverage = 1.0;' } },
};

const coverageOutput: SceneOutput = {
  name: 'coverage',
  format: 'r16float',
  bits: { opaque: coverageBit },
  clearValue: [0.5, 0, 0, 0],
};

const SHOW_RED: EffectFragment = {
  gpu: 'fn effect(uv: vec2<f32>) -> vec4<f32> { return vec4<f32>(sampleColor(uv).r, 0.0, 0.0, 1.0); }',
  gl: 'vec4 effect(vec2 uv) { return vec4(sampleColor(uv).r, 0.0, 0.0, 1.0); }',
};

class CopyCoverage extends Pass3D {
  public readonly requiredOutputs = [coverageOutput];

  constructor(
    public readonly stage: PassStage,
    private readonly _into: RenderTexture,
  ) {
    super();
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    graph.addPass(
      new FullscreenPass({
        renderer: ctx.renderer,
        label: 'copyCoverage',
        fragment: SHOW_RED,
        reads: { color: graph.getSceneOutput(coverageOutput) },
        writes: graph.importColor(() => this._into),
      }),
    );
  }
}

function sortedUids(textures: Texture[]): number[] {
  return textures.map((texture) => texture.uid).sort((a, b) => a - b);
}

function bars(options: Partial<View3DOptions>): View3D {
  const view = new View3D({ width: WIDTH, height: HEIGHT, toneMapping: 'none', ...options });
  view.camera.position.z = 4;
  view.camera.lookAt({ x: 0, y: 0, z: 0 });
  const bar = new Material3D({ baseColor: 0xffffff, emissive: { color: 0xffffff, strength: 1 } });
  for (let i = 0; i < 5; i++) {
    const mesh = new Mesh3D({
      geometry: new CubeGeometry({ width: 0.05, height: 2.4, depth: 0.05 }),
      material: bar,
    });
    mesh.position.set(-1.2 + i * 0.6, 0, 0);
    mesh.rotation.set(0, 0, 0.15 * (i - 2));
    view.root.addChild(mesh);
  }
  return view;
}

function blendedPixels(pixels: ArrayLike<number>, channels: readonly number[] = [0, 1, 2]): number {
  let blended = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    let value = 0;
    for (const channel of channels) value = Math.max(value, pixels[i + channel]);
    if (value > 24 && value < 232) blended++;
  }
  return blended;
}

function litPixels(pixels: ArrayLike<number>): number {
  let lit = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 24) lit++;
  }
  return lit;
}

function storeMultisampledColorAsDesktopGpusDo(app: Application<Renderer>): void {
  if (app.renderer.type === RendererType.WEBGPU) {
    (app.renderer as WebGPURenderer).device.extensions.tileBased = false;
  }
}

function water(): Mesh3D {
  const material = new Material3D({ baseColor: 0, emissive: { color: 0xff0000, strength: 1 } });
  material._passBit = RenderPassBit.BLENDED_REFRACTION;
  const mesh = new Mesh3D({ geometry: new CubeGeometry({ width: 0.6, height: 0.6, depth: 0.05 }), material });
  mesh.position.set(-0.4, 0, 1);
  return mesh;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`antialiased transients (${preference})`, () => {
    afterEach(() => vi.restoreAllMocks());

    it('gives the scene pair the canvas antialias and nothing else, and the picture survives the resolve', async () => {
      const app = await getApp<Renderer>({
        id: `antialias-scene-pair-${preference}`,
        appOptions: { preference, width: WIDTH, height: HEIGHT, antialias: true, resolution: 1 },
      });
      try {
        const view = scene({ passes: [new TintEffect(), new TintEffect()] });
        app.stage.addChild(view);

        const spy = vi.spyOn(TexturePool, 'getOptimalTexture');
        await expectCleanRender(app);
        const requests = antialiasByLabel(spy);

        expect(requests.get('sceneColor')).toBe(true);
        expect(requests.get('sceneDepth')).toBe(true);
        expect(requests.get('effectChain')).toBe(false);
        expect(requests.get('opaqueColorCopy')).toBe(false);
        expect(requests.has('sceneDepthResolve'), "the tint doesn't read depth, so nothing copies it").toBe(false);

        app.render();
        const [r, g, b] = readCanvasPixels(app.canvas, WIDTH / 2, HEIGHT / 2, 1, 1);
        expect(Math.max(r, g, b), 'the lit cube reaches the canvas through the resolved scene colour').toBeGreaterThan(
          128,
        );
      } finally {
        app.destroy(true);
      }
    });

    it('blends the edges it draws through a post effect, as the canvas does without one', async () => {
      const blendedByAntialias: number[] = [];
      for (const antialias of [false, true]) {
        const app = await getApp<Renderer>({
          id: `antialias-edges-${antialias}-${preference}`,
          appOptions: { preference, width: WIDTH, height: HEIGHT, antialias, resolution: 1, backgroundColor: 0 },
        });
        try {
          app.stage.addChild(bars({ passes: [new TintEffect()] }));

          await expectCleanRender(app);
          app.render();
          blendedByAntialias.push(blendedPixels(readCanvasPixels(app.canvas)));
        } finally {
          app.destroy(true);
        }
      }
      const [aliased, antialiased] = blendedByAntialias;
      expect(antialiased, 'multisampling blends the pixels along each edge').toBeGreaterThan(200);
      expect(aliased, 'a single-sample scene colour leaves the edges as steps').toBeLessThan(antialiased / 4);
    });

    it('keeps every transient single-sample on a canvas without antialias', async () => {
      const app = await getApp<Renderer>({
        id: `antialias-off-${preference}`,
        appOptions: { preference, width: WIDTH, height: HEIGHT, antialias: false },
      });
      try {
        app.stage.addChild(scene({ passes: [new SsaoEffect()] }));

        const spy = vi.spyOn(TexturePool, 'getOptimalTexture');
        await expectCleanRender(app);
        const requests = antialiasByLabel(spy);

        expect(requests.get('sceneColor')).toBe(false);
        expect(requests.get('sceneDepth')).toBe(false);
        expect(requests.has('sceneDepthResolve'), 'a single-sample depth is sampled as it is').toBe(false);
      } finally {
        app.destroy(true);
      }
    });

    for (const [format, multisampled] of [
      ['rg16float', true],
      ['rgba8unorm', preference === 'webgpu'],
      ['r32uint', false],
    ] as const) {
      it(`draws a view with an ${format} scene output ${multisampled ? 'multisampled, output and all' : 'single-sample'}`, async () => {
        const app = await getApp<Renderer>({
          id: `antialias-scene-output-${format}-${preference}`,
          appOptions: { preference, width: WIDTH, height: HEIGHT, antialias: true, resolution: 1 },
        });
        try {
          app.stage.addChild(scene({ passes: [new RequireOutput({ name: 'probe', format })] }));

          const spy = vi.spyOn(TexturePool, 'getOptimalTexture');
          await expectCleanRender(app);
          const requests = antialiasByLabel(spy);

          expect(requests.get('sceneColor')).toBe(multisampled);
          expect(requests.get('sceneDepth')).toBe(multisampled);
          expect(requests.get('probe'), 'every attachment of the scene target shares one sample count').toBe(
            multisampled,
          );

          app.render();
          const [r, g, b] = readCanvasPixels(app.canvas, WIDTH / 2, HEIGHT / 2, 1, 1);
          expect(Math.max(r, g, b), 'the lit cube reaches the canvas').toBeGreaterThan(128);
        } finally {
          app.destroy(true);
        }
      });
    }

    it('keeps the edges smooth under motion blur, and streaks them when the camera turns', async () => {
      const blendedStill: number[] = [];
      const litStill: number[] = [];
      const litTurning: number[] = [];
      for (const antialias of [false, true]) {
        const app = await getApp<Renderer>({
          id: `antialias-motion-blur-${antialias}-${preference}`,
          appOptions: {
            preference,
            width: WIDTH,
            height: HEIGHT,
            antialias,
            resolution: 1,
            backgroundColor: 0,
            autoStart: false,
          },
        });
        try {
          const view = bars({ passes: [new MotionBlurEffect({ intensity: 1, samples: 16 })] });
          const backdrop = new Mesh3D({
            geometry: new CubeGeometry({ width: 20, height: 20, depth: 0.1 }),
            material: new Material3D({ baseColor: 0 }),
          });
          backdrop.position.z = -1;
          view.root.addChild(backdrop);
          app.stage.addChild(view);

          await renderFrame(app);
          const still = await renderFrame(app);
          view.camera.lookAt({ x: 0.3, y: 0, z: 0 });
          const turning = await renderFrame(app);

          blendedStill.push(blendedPixels(still));
          litStill.push(litPixels(still));
          litTurning.push(litPixels(turning));
        } finally {
          app.destroy(true);
        }
      }
      const [aliased, antialiased] = blendedStill;
      expect(antialiased, 'the velocity is multisampled with the scene, so the edges stay blended').toBeGreaterThan(
        200,
      );
      expect(aliased, 'a single-sample scene leaves the edges as steps').toBeLessThan(antialiased / 4);
      expect(litTurning[1], 'the turn smears each bar over the dark backdrop').toBeGreaterThan(litStill[1] * 2);
      expect(litTurning[1], 'the averaged velocity streaks as far as the single-sample one').toBeGreaterThan(
        litTurning[0] * 0.8,
      );
    });

    it("reads this frame's scene output in an 'afterOpaque' pass, before the transparent pass writes it again", async () => {
      const app = await getApp<Renderer>({
        id: `antialias-after-opaque-output-${preference}`,
        appOptions: { preference, width: 64, height: 64, antialias: true, resolution: 1, autoStart: false },
      });
      const into = RenderTexture.create({ width: 64, height: 64 });
      try {
        const view = new View3D({ width: 64, height: 64, passes: [new CopyCoverage('afterOpaque', into)] });
        view.camera.position.z = 4;
        const cube = new Mesh3D({
          geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 }),
          material: new Material3D({ baseColor: 0xffffff }),
        });
        view.root.addChild(cube);
        const pane = new Mesh3D({
          geometry: new CubeGeometry({ width: 0.2, height: 0.2, depth: 0.2 }),
          material: new Material3D({ baseColor: 0x00ff00, alphaMode: 'blend', alpha: 0.5 }),
        });
        pane.position.set(1.6, 1.2, 0);
        view.root.addChild(pane);
        app.stage.addChild(view);
        const centre = (32 * 64 + 32) * 4;

        await expectCleanRender(app);
        const covered = app.renderer.extract.pixels({ target: into }).pixels[centre];
        cube.position.x = 10;
        await expectCleanRender(app);
        const uncovered = app.renderer.extract.pixels({ target: into }).pixels[centre];

        expect(covered, 'the cube wrote the output this frame').toBe(255);
        expect(
          Math.abs(uncovered - 128),
          "the cube moved away this frame, so the pixel holds the output's clear value, not last frame's 1",
        ).toBeLessThanOrEqual(2);
      } finally {
        into.destroy(true);
        app.destroy(true);
      }
    });

    for (const [name, effect, readsMips] of [
      ['SSAO', () => new SsaoEffect(), false],
      ['tilt-shift', () => new TiltShiftEffect({ focalDepth: 3.25, focalNear: 0.5, focalFar: 1.5 }), true],
    ] as const) {
      it(`resolves a multisampled depth for ${name} into a single-sample copy, and gives the copy back to the pool`, async () => {
        const app = await getApp<Renderer>({
          id: `antialias-depth-resolve-${name}-${preference}`,
          appOptions: { preference, width: WIDTH, height: HEIGHT, antialias: true, resolution: 1 },
        });
        try {
          app.stage.addChild(scene({ passes: [effect()] }));

          const taken = vi.spyOn(TexturePool, 'getOptimalTexture');
          const returned = vi.spyOn(TexturePool, 'returnTexture');
          await expectCleanRender(app);
          await expectCleanRender(app);
          app.render();
          const [r, g, b] = readCanvasPixels(app.canvas, WIDTH / 2, HEIGHT / 2, 1, 1);
          const [pastEdge] = readCanvasPixels(app.canvas, 133, HEIGHT / 2, 1, 1);
          const requests = antialiasByLabel(taken);

          expect(requests.get('sceneDepth')).toBe(true);
          expect(requests.get('sceneDepthResolve')).toBe(false);
          expect(
            poolCalls(taken).some(
              (options) => options.label === 'sceneColor' && options.antialias && options.autoGenerateMipmaps,
            ),
            'the scene colour is multisampled, and mip-chained for an effect that reads its mips',
          ).toBe(readsMips);
          expect(
            sortedUids(returned.mock.calls.map(([texture]) => texture)),
            'every texture taken from the pool goes back to it',
          ).toEqual(sortedUids(taken.mock.results.map((result) => result.value as Texture)));
          expect(
            Math.max(r, g, b),
            'the lit cube reaches the canvas through the resolved scene colour',
          ).toBeGreaterThan(128);
          expect(pastEdge, 'the cube keeps a sharp edge, so the effect read the scene depth').toBeLessThan(30);
        } finally {
          app.destroy(true);
        }
      });
    }

    it("antialiases a camera's feed when its render texture asks for it", async () => {
      const blendedByAntialias: number[] = [];
      for (const antialias of [false, true]) {
        const app = await getApp<Renderer>({
          id: `antialias-camera-feed-${antialias}-${preference}`,
          appOptions: { preference, width: WIDTH, height: HEIGHT, antialias: false, resolution: 1, backgroundColor: 0 },
        });
        const feed = RenderTexture.create({ width: WIDTH, height: HEIGHT, antialias });
        try {
          const camera = new Camera3D({ renderTexture: feed });
          camera.position.z = 4;
          const view = bars({ passes: [new MeshPass({ name: 'opaque', camera })] });
          view.root.addChild(camera);
          app.stage.addChild(view);

          await expectCleanRender(app);
          app.render();
          const feedPixels = app.renderer.extract.pixels({ target: feed }).pixels;
          blendedByAntialias.push(blendedPixels(feedPixels, [3]));
        } finally {
          feed.destroy(true);
          app.destroy(true);
        }
      }
      const [aliased, antialiased] = blendedByAntialias;
      expect(
        antialiased,
        'the feed is multisampled and resolved before the copy, so edge coverage shows in its alpha, which extract reads alike on both backends',
      ).toBeGreaterThan(200);
      expect(aliased, 'a single-sample feed leaves the edges as steps').toBeLessThan(antialiased / 4);
    });

    for (const transparent of [false, true]) {
      it(`draws water over the antialiased scene through a post effect${transparent ? ', with a transparent mesh after it' : ''}`, async () => {
        const app = await getApp<Renderer>({
          id: `antialias-water-${transparent}-${preference}`,
          appOptions: { preference, width: WIDTH, height: HEIGHT, antialias: true, resolution: 1, backgroundColor: 0 },
        });
        try {
          storeMultisampledColorAsDesktopGpusDo(app);
          const view = new View3D({ width: WIDTH, height: HEIGHT, toneMapping: 'none', passes: [new TintEffect()] });
          view.camera.position.z = 4;
          view.camera.lookAt({ x: 0, y: 0, z: 0 });
          view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 1 }));
          view.root.addChild(
            new Mesh3D({
              geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 }),
              material: new Material3D({ baseColor: 0xffffff, roughness: 1 }),
            }),
          );
          view.root.addChild(water());
          const hidden = water();
          hidden.position.set(0, 0, -1);
          view.root.addChild(hidden);
          if (transparent) {
            const pane = new Mesh3D({
              geometry: new CubeGeometry({ width: 0.2, height: 0.2, depth: 0.2 }),
              material: new Material3D({ baseColor: 0x00ff00, alphaMode: 'blend', alpha: 0.5 }),
            });
            pane.position.set(1.6, 1.2, 0);
            view.root.addChild(pane);
          }
          app.stage.addChild(view);

          await expectCleanRender(app);
          app.render();
          const [waterR, waterG] = readCanvasPixels(app.canvas, 82, 80, 1, 1);
          const [, cubeG] = readCanvasPixels(app.canvas, 125, 80, 1, 1);
          const [, centreG] = readCanvasPixels(app.canvas, WIDTH / 2, HEIGHT / 2, 1, 1);

          expect(waterR, 'the water reaches the canvas').toBeGreaterThan(200);
          expect(waterG, 'the water reaches the canvas').toBeLessThan(60);
          expect(
            cubeG,
            'the cube behind the water survives it, which a tile-based GPU refilling from the resolve would hide',
          ).toBeGreaterThan(100);
          expect(centreG, 'the cube hides water behind it').toBeGreaterThan(100);
        } finally {
          app.destroy(true);
        }
      });
    }
  });
}
