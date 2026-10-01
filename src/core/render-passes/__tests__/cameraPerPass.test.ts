import { getApp } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { Rectangle, RenderTexture } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { getCameraData } from '~/core/CameraData';
import { prepareCamera, updateCameraProjectionForView } from '~/core/prepareCamera';
import type { RenderGraph } from '~/core/render-graph/RenderGraph';
import { BlendedRefractionPass } from '~/core/render-passes/blended-refraction/BlendedRefractionPass';
import { CopyDepthPass } from '~/core/render-passes/copy-depth/CopyDepthPass';
import { CopyOpaquePass } from '~/core/render-passes/copy-opaque/CopyOpaquePass';
import { DepthClearPass } from '~/core/render-passes/depth-clear/DepthClearPass';
import { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { OpaqueRenderPass } from '~/core/render-passes/opaque/OpaqueRenderPass';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import type { RenderSession } from '~/core/render-passes/RenderSession';
import { TransmissionRenderPass } from '~/core/render-passes/transmission/TransmissionRenderPass';
import { TransparentRenderPass } from '~/core/render-passes/transparent/TransparentRenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { Pass3D } from '~/post-processing/Pass3D';
import type { PassContext, PassStage } from '~/post-processing/Pass3D';
import { Camera3D } from '~/scene/cameras/Camera3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/** A named forward pass from `camera`, with its own descriptor */
class NightVisionPass extends Pass3D {
  public readonly stage: Exclude<PassStage, 'post'> = 'afterTransparent';

  constructor(private readonly _camera: Camera3D) {
    super();
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    graph.addPass(
      new ForwardRenderPass({
        renderer: ctx.renderer,
        name: 'nightVision',
        sort: 'key',
        camera: this._camera,
        descriptor: { state: new Material3D().state },
      }),
    );
  }
}

/** Adds one extra opaque forward pass, optionally from a second camera */
class ExtraOpaquePass extends Pass3D {
  public readonly stage: Exclude<PassStage, 'post'>;

  private readonly _camera?: Camera3D;
  private readonly _withDescriptor: boolean;

  constructor(camera?: Camera3D, withDescriptor = false, stage: Exclude<PassStage, 'post'> = 'afterTransparent') {
    super();
    this._camera = camera;
    this._withDescriptor = withDescriptor;
    this.stage = stage;
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    graph.addPass(
      new ForwardRenderPass({
        renderer: ctx.renderer,
        name: 'opaque',
        sort: 'key',
        camera: this._camera,
        descriptor: this._withDescriptor ? { state: new Material3D().state } : undefined,
      }),
    );
  }
}

/** Adds the default scene sequence for `camera`, pointed at its render texture */
class FeedGlassPass extends Pass3D {
  public readonly stage: Exclude<PassStage, 'post'> = 'beforeOpaque';

  constructor(private readonly _camera: Camera3D) {
    super();
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    const { renderer } = ctx;
    const camera = this._camera;
    const opaqueColorHandle = graph.createColor({ autoGenerateMipmaps: true, label: 'feedOpaqueColor' });
    const opaqueDepthHandle = graph.createDepth({ label: 'feedOpaqueDepth' });

    graph.addPass(new OpaqueRenderPass({ renderer, camera }));
    graph.addPass(new CopyDepthPass({ renderer, camera, opaqueDepthHandle }));
    graph.addPass(new CopyOpaquePass({ renderer, camera, opaqueColorHandle }));
    graph.addPass(new TransmissionRenderPass({ renderer, camera, opaqueColorHandle }));
    graph.addPass(new BlendedRefractionPass({ renderer, camera, opaqueColorHandle, opaqueDepthHandle }));
    graph.addPass(new TransparentRenderPass({ renderer, camera }));
  }
}

/** A picture-in-picture inset: a depth clear plus an opaque draw, both from `camera` */
class InsetPass extends Pass3D {
  public readonly stage: Exclude<PassStage, 'post'> = 'afterTransparent';

  constructor(private readonly _camera: Camera3D) {
    super();
  }

  public build(graph: RenderGraph, ctx: PassContext): void {
    const { renderer } = ctx;
    const camera = this._camera;

    graph.addPass(new DepthClearPass({ renderer, camera }));
    graph.addPass(new ForwardRenderPass({ renderer, name: 'opaque', sort: 'key', camera }));
  }
}

const VIEW_SIZE = 128;

/** Where the composite variant sits the view, so the transient's space differs from the screen's */
const OFFSET_X = 40;
const OFFSET_Y = 24;

function buildView(options: { composite?: boolean } = {}): { view3d: View3D; camera: Camera3D } {
  const view3d = new View3D({ width: VIEW_SIZE, height: VIEW_SIZE, composite: options.composite });
  const mesh = new Mesh3D({
    geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
    material: new Material3D({ baseColor: 0xff0000 }),
  });
  mesh.position.set(0, 0, -3);
  view3d.root.addChild(mesh);

  const camera = new Camera3D();
  camera.position.set(0, 3, 3);
  camera.viewport.x = 0.6;
  camera.viewport.y = 0.6;
  camera.viewport.width = 0.4;
  camera.viewport.height = 0.4;
  view3d.root.addChild(camera);

  return { view3d, camera };
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`camera per pass (${preference})`, () => {
    it('lets two passes share a name when their cameras differ, the view camera owning the lookups', async () => {
      const app = await getApp<Renderer>({
        id: `camera-per-pass-two-nodes-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const { view3d, camera } = buildView();
        view3d.passes = [new ExtraOpaquePass(camera)];
        app.stage.addChild(view3d);
        app.render();

        const opaquePasses = view3d._graph.passes.filter((p) => p.name === 'opaque') as ForwardRenderPass[];
        expect(opaquePasses).toHaveLength(2);
        expect(opaquePasses[0].camera).toBeNull();
        expect(opaquePasses[1].camera).toBe(camera);
        expect(opaquePasses[0].bit, 'one bit, so one draw list').toBe(opaquePasses[1].bit);
        expect(opaquePasses[0].cullResults, 'what each frustum keeps is its own').not.toBe(opaquePasses[1].cullResults);

        expect(view3d.passByBit[RenderPassBit.OPAQUE]).toBe(opaquePasses[0]);
      } finally {
        app.destroy();
      }
    });

    it('leaves the lookups with the view camera even when a camera pass is declared first, as a beforeOpaque feed is', async () => {
      const app = await getApp<Renderer>({
        id: `camera-per-pass-before-opaque-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const { view3d, camera } = buildView();
        view3d.passes = [new ExtraOpaquePass(camera, false, 'beforeOpaque')];
        app.stage.addChild(view3d);
        app.render();

        const opaquePasses = view3d._graph.passes.filter((p) => p.name === 'opaque') as ForwardRenderPass[];
        expect(opaquePasses).toHaveLength(2);
        expect(opaquePasses[0].camera).toBe(camera);
        expect(opaquePasses[1].camera).toBeNull();

        expect(view3d.passByBit[RenderPassBit.OPAQUE]).toBe(opaquePasses[1]);
      } finally {
        app.destroy();
      }
    });

    it('rejects a second pass on a name with no camera of its own', async () => {
      const app = await getApp<Renderer>({
        id: `camera-per-pass-duplicate-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const { view3d } = buildView();
        view3d.passes = [new ExtraOpaquePass()];
        app.stage.addChild(view3d);
        expect(() => app.render()).toThrow(/used twice in this view/);
      } finally {
        app.destroy();
      }
    });

    it('rejects a camera pass that brings a descriptor on a name the view already draws', async () => {
      const app = await getApp<Renderer>({
        id: `camera-per-pass-descriptor-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const { view3d, camera } = buildView();
        view3d.passes = [new ExtraOpaquePass(camera, true)];
        app.stage.addChild(view3d);
        expect(() => app.render()).toThrow(/another pass owns that name/);
      } finally {
        app.destroy();
      }
    });

    it('rejects that descriptor even when the camera pass is declared first', async () => {
      const app = await getApp<Renderer>({
        id: `camera-per-pass-descriptor-first-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const { view3d, camera } = buildView();
        view3d.passes = [new ExtraOpaquePass(camera, true, 'beforeOpaque')];
        app.stage.addChild(view3d);
        expect(() => app.render()).toThrow(/another pass owns that name/);
      } finally {
        app.destroy();
      }
    });

    it('lets a camera pass bring a descriptor when the name is its own', async () => {
      const app = await getApp<Renderer>({
        id: `camera-per-pass-own-descriptor-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const { view3d, camera } = buildView();
        view3d.passes = [new NightVisionPass(camera)];
        app.stage.addChild(view3d);
        app.render();

        const night = view3d._graph.passes.find((p) => p.name === 'nightVision') as ForwardRenderPass;
        expect(night.camera).toBe(camera);
        expect(night.descriptor).toBeDefined();
        expect(view3d.passByBit[night.bit]).toBe(night);
      } finally {
        app.destroy();
      }
    });

    it('points copy and glass passes at a camera when given one', async () => {
      const app = await getApp<Renderer>({
        id: `camera-per-pass-glass-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });
      const display = RenderTexture.create({ width: 128, height: 72, resolution: 1 });

      try {
        const { view3d } = buildView();
        const feedCamera = new Camera3D({ renderTexture: display });
        feedCamera.position.set(0, 2, 2);
        view3d.root.addChild(feedCamera);
        view3d.passes = [new FeedGlassPass(feedCamera)];
        app.stage.addChild(view3d);
        app.render();

        const graph = view3d._graph;

        const copyOpaques = graph.passes.filter((p): p is CopyOpaquePass => p instanceof CopyOpaquePass);
        expect(copyOpaques).toHaveLength(2);
        expect(copyOpaques.map((p) => p.camera)).toEqual(expect.arrayContaining([null, feedCamera]));

        const copyDepths = graph.passes.filter((p): p is CopyDepthPass => p instanceof CopyDepthPass);
        expect(copyDepths).toHaveLength(2);
        expect(copyDepths.map((p) => p.camera)).toEqual(expect.arrayContaining([null, feedCamera]));

        const transmissions = graph.passes.filter((p) => p.name === 'transmission');
        expect(transmissions).toHaveLength(2);
        expect(transmissions[0].camera).toBe(feedCamera);
        expect(transmissions[1].camera).toBeNull();

        const refractions = graph.passes.filter((p) => p.name === 'blendedRefraction');
        expect(refractions[0].camera).toBe(feedCamera);
        expect(refractions[1].camera).toBeNull();
      } finally {
        display.destroy(true);
        app.destroy();
      }
    });

    for (const composite of [false, true] as const) {
      const through = composite ? 'through a scene transient' : 'straight to the screen';

      it(`draws an inset camera inside its viewport and nowhere else, ${through}`, async () => {
        const canvas = composite ? VIEW_SIZE + OFFSET_X : VIEW_SIZE;
        const app = await getApp<Renderer>({
          id: `camera-per-pass-viewport-${composite ? 'composite' : 'direct'}-${preference}`,
          appOptions: { preference, width: canvas, height: canvas },
        });

        try {
          const { view3d, camera } = buildView({ composite });
          if (composite) view3d.position.set(OFFSET_X, OFFSET_Y);

          camera.mode = 'orthographic';
          camera.orthographicSize = 6;
          camera.near = 1;
          camera.far = 34;
          camera.position.set(0, 24, -3);
          camera.rotation.set(-Math.PI / 2, 0, 0);
          camera.rotationDirty = true;

          /**
           * A floor for the inset to look straight down on, which the view camera lies in and never
           * sees; unlit, since a lit material in this view with no lights would read black on black
           */
          const ground = new Mesh3D({
            geometry: new PlaneGeometry({ width: 40, height: 40 }),
            material: new FlatMaterial({ baseColor: 0x3366ff }),
          });
          ground.rotation.set(-Math.PI / 2, 0, 0);
          ground.rotationDirty = true;
          view3d.root.addChild(ground);

          const inset = new InsetPass(camera);
          view3d.passes = [inset];
          app.stage.addChild(view3d);

          inset.enabled = false;
          app.render();
          const plain = app.renderer.extract.pixels({ target: app.stage, frame: app.screen });
          inset.enabled = true;
          app.render();
          const withInset = app.renderer.extract.pixels({ target: app.stage, frame: app.screen });

          const scale = plain.width / app.screen.width;
          /** Where the graph put the camera, in screen pixels; padded 2px below for the viewport's rounding */
          const frame = getCameraData(camera).frame;
          const left = Math.floor(frame.x * scale) - 2;
          const right = Math.ceil((frame.x + frame.width) * scale) + 2;
          const top = Math.floor(frame.y * scale) - 2;
          const bottom = Math.ceil((frame.y + frame.height) * scale) + 2;

          let outsideDiffering = 0;
          let insideDiffering = 0;
          for (let y = 0; y < plain.height; y++) {
            for (let x = 0; x < plain.width; x++) {
              const i = (y * plain.width + x) * 4;
              const differs =
                plain.pixels[i] !== withInset.pixels[i] ||
                plain.pixels[i + 1] !== withInset.pixels[i + 1] ||
                plain.pixels[i + 2] !== withInset.pixels[i + 2] ||
                plain.pixels[i + 3] !== withInset.pixels[i + 3];
              if (!differs) continue;
              if (x >= left && x < right && y >= top && y < bottom) insideDiffering++;
              else outsideDiffering++;
            }
          }

          expect(outsideDiffering, "not a pixel outside the camera's rect may change").toBe(0);
          expect(insideDiffering, 'the floor fills the rect over an empty background').toBeGreaterThan(
            ((right - left) * (bottom - top)) / 2,
          );
        } finally {
          app.destroy();
        }
      });
    }

    it("puts an inset camera's frame where the view puts it on screen, with the view off the screen origin", async () => {
      const app = await getApp<Renderer>({
        id: `camera-per-pass-frame-${preference}`,
        appOptions: { preference, width: 256, height: 256 },
      });

      try {
        const { view3d, camera } = buildView();
        view3d.position.set(OFFSET_X, OFFSET_Y);
        view3d.passes = [new InsetPass(camera)];
        app.stage.addChild(view3d);
        app.render();

        const { viewport } = camera;
        const { x, y, width, height } = getCameraData(camera).frame;
        expect([x, y, width, height]).toEqual([
          OFFSET_X + viewport.x * VIEW_SIZE,
          OFFSET_Y + viewport.y * VIEW_SIZE,
          viewport.width * VIEW_SIZE,
          viewport.height * VIEW_SIZE,
        ]);
      } finally {
        app.destroy();
      }
    });
  });
}

describe('camera per pass (webgpu records)', () => {
  it('gives each camera on one name its own cull result for the batch, which WebGL has none of', async () => {
    const app = await getApp<Renderer>({
      id: 'camera-per-pass-results',
      appOptions: { preference: 'webgpu', width: 128, height: 128 },
    });

    try {
      const { view3d, camera } = buildView();
      view3d.passes = [new ExtraOpaquePass(camera)];
      app.stage.addChild(view3d);
      app.render();

      const [main, inset] = view3d._graph.passes.filter((p) => p.name === 'opaque') as ForwardRenderPass[];
      const batch = view3d._sceneBatch;

      expect(main.cullResults.get(batch)).toBeDefined();
      expect(inset.cullResults.get(batch)).toBeDefined();
      expect(main.cullResults.get(batch)).not.toBe(inset.cullResults.get(batch));
    } finally {
      app.destroy();
    }
  });
});

describe('prepareCamera', () => {
  it('rejects a camera outside the view it draws for', () => {
    const view3d = new View3D({ width: 128, height: 128 });
    const stray = new Camera3D();

    expect(() => prepareCamera(stray, { view3d } as RenderSession)).toThrow(/must live in the View3D/);
  });
});

describe('updateCameraProjectionForView', () => {
  const SCREEN = new Rectangle(0, 0, 256, 256);
  const NO_OFFSET = { x: 0, y: 0 };

  /** A detached view — no parent, so the world transform is identity and the maths reads directly */
  function insetIn(view3d: View3D, viewport: Partial<Rectangle>): Camera3D {
    const camera = new Camera3D({ fov: 60 });
    Object.assign(camera.viewport, viewport);
    view3d.root.addChild(camera);
    return camera;
  }

  it('places the camera by its viewport and takes the aspect from that rect', () => {
    const view3d = new View3D({ width: 128, height: 128 });
    const camera = insetIn(view3d, { x: 0.5, y: 0.25, width: 0.5, height: 0.25 });

    const frame = updateCameraProjectionForView(view3d, camera, SCREEN, NO_OFFSET)!;

    expect([frame.x, frame.y, frame.width, frame.height]).toEqual([64, 32, 64, 32]);
    /** `1 / tan(fov / 2)` at 60°: the projection's y scale, and its x scale times the aspect */
    const f = 1 / Math.tan(Math.PI / 6);
    const e = camera.projection.elements;
    expect(e[0]).toBeCloseTo(f / 2, 5);
    expect(e[5]).toBeCloseTo(f, 5);
  });

  it('clips the frame to the screen and zooms the projection into what is left', () => {
    const view3d = new View3D({ width: 256, height: 256 });
    const camera = insetIn(view3d, { x: 0.75, width: 0.5, height: 1 });

    const frame = updateCameraProjectionForView(view3d, camera, SCREEN, NO_OFFSET)!;

    expect([frame.x, frame.width], 'asked for 192..320 of a 256-wide screen').toEqual([192, 64]);
    /** `1 / tan(fov / 2)` at 60° */
    const f = 1 / Math.tan(Math.PI / 6);
    const e = camera.projection.elements;
    expect(e[0], "the unclipped rect's aspect, zoomed into the visible half").toBeCloseTo((f / 0.5) * 2, 5);
    expect(e[8], 'how far the visible centre sits from the intended one').toBeCloseTo(-1, 5);
  });

  it("offsets by the renderer's own origin, so a view inside a filter still lands right", () => {
    const view3d = new View3D({ width: 128, height: 128 });
    const camera = insetIn(view3d, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 });

    const frame = updateCameraProjectionForView(view3d, camera, SCREEN, { x: 20, y: 12 })!;

    expect([frame.x, frame.y]).toEqual([64 - 20, 64 - 12]);
  });

  it('reports no frame when the camera lands entirely past the edge of the screen', () => {
    const view3d = new View3D({ width: 256, height: 256 });
    const camera = insetIn(view3d, { x: 2.2, width: 0.4, height: 0.4 });

    expect(updateCameraProjectionForView(view3d, camera, SCREEN, NO_OFFSET)).toBeUndefined();
  });

  it('keeps an inset on screen while any of it still overlaps', () => {
    const view3d = new View3D({ width: 256, height: 256 });
    const camera = insetIn(view3d, { x: 0.9, width: 0.4, height: 0.4 });

    expect(
      updateCameraProjectionForView(view3d, camera, SCREEN, NO_OFFSET),
      '230.4..332.8 of a 256-wide screen straddles its edge',
    ).toBeDefined();

    camera.viewport.x = 2.2;
    expect(updateCameraProjectionForView(view3d, camera, SCREEN, NO_OFFSET)).toBeUndefined();
  });
});
