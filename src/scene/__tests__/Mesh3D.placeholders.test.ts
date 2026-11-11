import { expectCleanRender, getApp, readCanvasPixels } from '@test-utils';
import { Rectangle } from 'pixi.js';
import type { Application, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { MESH3D_LANE_MORPH_WEIGHT, MESH3D_STORE_STRIDE } from '~/core/buffers/Mesh3DDataStoreBuffer';
import { updateCameraProjectionForView } from '~/core/prepareCamera';
import { passBitRegistry } from '~/core/render-passes/passBitRegistry';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { OutlinePass } from '~/extras/post-processing/passes/OutlinePass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { updateView3DTransforms } from '~/scene/utils/updateView3DTransforms';
import { View3D } from '~/scene/View3D';

type App = Application<WebGLRenderer | WebGPURenderer>;

const SIZE = 64;

const PICK_SCREEN = new Rectangle(0, 0, 100, 100);

function morphTriangle(targetCount: number): Geometry3D {
  const morphTargets: { positions: Float32Array }[] = [];
  for (let i = 0; i < targetCount; i++) {
    morphTargets.push({ positions: new Float32Array([0, 0, i + 1, 0, 0, i + 1, 0, 0, i + 1]) });
  }

  return new Geometry3D({
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    morphTargets,
  });
}

function tickPick(view3d: View3D): void {
  view3d.camera.localTransform.compose(view3d.camera.position, view3d.camera.quaternion, view3d.camera.scale);
  view3d.camera.worldTransform.copyFrom(view3d.camera.localTransform);
  updateCameraProjectionForView(view3d, view3d.camera, PICK_SCREEN, { x: 0, y: 0 });
  updateView3DTransforms(view3d);
}

describe('Mesh3D placeholders', () => {
  it('starts on the shared placeholders, in no pass, when built with no geometry or material', () => {
    for (const mesh of [new Mesh3D(), new Mesh3D({})]) {
      expect(mesh.geometry).toBe(Geometry3D.EMPTY);
      expect(mesh.material).toBe(BaseMaterial3D.EMPTY);
      expect(mesh.castShadow).toBe(true);
      expect(mesh.renderPassMask, 'not even the shadow pass').toBe(0);
      expect(mesh._morph).toBeUndefined();
      expect(mesh.boundingSphere.isEmpty()).toBe(true);
    }
  });

  it('builds the geometry placeholder whatever Geometry3D.defaultOptions say', () => {
    const statics = Geometry3D as unknown as { _empty: Geometry3D | null };
    const shared = Geometry3D.EMPTY;
    const interleave = Geometry3D.defaultOptions.interleave;
    statics._empty = null;
    Geometry3D.defaultOptions.interleave = true;

    try {
      const mesh = new Mesh3D({ geometry: new CubeGeometry(), material: new FlatMaterial() });

      expect(mesh.renderPassMask).not.toBe(0);
      expect(Object.keys(Geometry3D.EMPTY.attributes)).toEqual([]);
    } finally {
      Geometry3D.defaultOptions.interleave = interleave;
      statics._empty = shared;
    }
  });

  it("isn't hit on a placeholder, and a 'box' hit volume given up front fits the geometry assigned later", () => {
    const view3d = new View3D({ width: 100, height: 100 });
    view3d.camera.position.set(0, 0, 10);
    const mesh = new Mesh3D({ eventMode: 'static', hitVolume: 'box', parent: view3d.root });

    try {
      tickPick(view3d);
      expect(view3d.raycast({ x: 50, y: 50 })).toBeNull();

      mesh.geometry = new CubeGeometry();
      mesh.material = new FlatMaterial();
      tickPick(view3d);
      expect(view3d.raycast({ x: 50, y: 50 })?.target).toBe(mesh);
    } finally {
      view3d.destroy();
    }
  });

  describe('morph', () => {
    it('ignores weights given before there is a morph geometry, as the weights setter does', () => {
      const mesh = new Mesh3D({ weights: new Float32Array([1, 1]) });

      mesh.geometry = morphTriangle(2);

      expect(mesh.weights).toEqual(new Float32Array(2));
    });

    it('keeps the weights for a geometry with as many targets, and resizes them for one with more', () => {
      const mesh = new Mesh3D({ geometry: morphTriangle(2) });
      const weights = mesh.weights!;
      weights[0] = 0.5;

      mesh.geometry = morphTriangle(2);
      expect(mesh.weights).toBe(weights);

      mesh.geometry = morphTriangle(3);
      expect(mesh.weights).toEqual(new Float32Array(3));
    });

    it('drops the morph for a geometry without targets, the placeholder included', () => {
      for (const geometry of [new CubeGeometry(), Geometry3D.EMPTY]) {
        const mesh = new Mesh3D({ geometry: morphTriangle(2) });

        mesh.geometry = geometry;

        expect(mesh._morph).toBeUndefined();
        expect(mesh.weights).toBeUndefined();
      }
    });
  });

  describe("the view's morphed list", () => {
    it('follows the morph as geometry swaps make and drop it', () => {
      const view = new View3D({ width: SIZE, height: SIZE });
      const mesh = new Mesh3D({ parent: view.root });

      try {
        mesh.geometry = morphTriangle(2);
        expect(view._morphedMeshes.items).toContain(mesh);

        mesh.geometry = morphTriangle(3);
        expect(view._morphedMeshes.items, 'a new morph keeps its place').toContain(mesh);

        mesh.geometry = Geometry3D.EMPTY;
        expect(view._morphedMeshes.items).not.toContain(mesh);
      } finally {
        view.destroy();
      }
    });
  });
});

async function renderDrawnPixels(app: App): Promise<number> {
  const device = (app.renderer as WebGPURenderer).gpu?.device;

  device?.pushErrorScope('validation');
  app.render();
  const data = readCanvasPixels(app.canvas);
  const error = await device?.popErrorScope();
  expect(error?.message ?? null).toBe(null);

  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 32 || data[i + 1] > 32 || data[i + 2] > 32) n++;
  }
  return n;
}

const shaderCount = (app: App): number => app.renderer.material3d._shaderCache.size;

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`Mesh3D placeholders when rendered (${preference})`, () => {
    const setup = async (id: string): Promise<{ app: App; view3d: View3D }> => {
      const app = await getApp<WebGLRenderer | WebGPURenderer>({
        id: `${id}-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x000000 },
      });
      const view3d = new View3D({ width: SIZE, height: SIZE });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 3);
      view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
      view3d.root.addChild(new DirectionalLight({ castShadow: true }));

      return { app, view3d };
    };

    it('issues no draw, builds no shader or store row, and uploads no geometry for a placeholder', async () => {
      const { app, view3d } = await setup('placeholder-no-draw');

      try {
        const bare = new Mesh3D({ parent: view3d.root });
        const geometryOnly = new Mesh3D({ geometry: new CubeGeometry(), parent: view3d.root });
        const materialOnly = new Mesh3D({ material: new FlatMaterial({ baseColor: 0xff2200 }), parent: view3d.root });

        const drawn = await renderDrawnPixels(app);

        expect(Object.keys(view3d._sceneBatch.drawLists), 'no pass draw list was ever made').toEqual([]);
        expect(shaderCount(app)).toBe(0);
        for (const mesh of [bare, geometryOnly, materialOnly]) expect(mesh._storeIndex).toBe(-1);
        expect(Geometry3D.EMPTY._geometryAtlasAllocation).toBeNull();
        expect(Geometry3D.EMPTY._geometryDataIndex).toBe(-1);
        expect(geometryOnly.geometry._geometryAtlasAllocation).toBeNull();
        expect(drawn).toBe(0);
      } finally {
        app.destroy();
      }
    });

    it('draws the same as a mesh given both up front when they are assigned after it joins the view', async () => {
      const { app, view3d } = await setup('placeholder-assign-attached');

      try {
        const geometry = new CubeGeometry();
        const material = new FlatMaterial({ baseColor: 0xff2200 });

        const reference = new Mesh3D({ geometry, material, parent: view3d.root });
        const referencePixels = await renderDrawnPixels(app);
        view3d.root.removeChild(reference);

        const late = new Mesh3D({ parent: view3d.root });
        await expectCleanRender(app);

        late.material = material;
        expect(await renderDrawnPixels(app), 'still on the placeholder geometry').toBe(0);

        late.geometry = geometry;
        const latePixels = await renderDrawnPixels(app);

        expect(referencePixels).toBeGreaterThan(0);
        expect(latePixels).toBe(referencePixels);
        expect(late._passCache[RenderPassBit.OPAQUE].shader).toBe(reference._passCache[RenderPassBit.OPAQUE].shader);
        expect(late._storeIndex).toBeGreaterThanOrEqual(0);
      } finally {
        app.destroy();
      }
    });

    it('draws when both are assigned before it joins the view, and stops when a placeholder goes back', async () => {
      const { app, view3d } = await setup('placeholder-assign-detached');

      try {
        const mesh = new Mesh3D();
        mesh.geometry = new CubeGeometry();
        mesh.material = new FlatMaterial({ baseColor: 0xff2200 });
        view3d.root.addChild(mesh);

        expect(await renderDrawnPixels(app)).toBeGreaterThan(0);

        mesh.geometry = Geometry3D.EMPTY;
        expect(await renderDrawnPixels(app)).toBe(0);
        expect(view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE].view.count).toBe(0);
      } finally {
        app.destroy();
      }
    });

    it('keeps castShadow, enablePass and disablePass set while it waits, and applies them once it has both', async () => {
      const { app, view3d } = await setup('placeholder-own-passes');
      view3d.passes = [new OutlinePass({ width: 0.1, color: 0xff0000 })];
      const outline = passBitRegistry.getOrAllocate('outline');
      const counts = (): number[] =>
        [RenderPassBit.OPAQUE, RenderPassBit.SHADOW, outline].map(
          (bit) => view3d._sceneBatch.drawLists[bit]?.view.count ?? 0,
        );

      try {
        const shadowless = new Mesh3D({ parent: view3d.root });
        shadowless.castShadow = false;
        shadowless.enablePass('outline');
        const shadowOnly = new Mesh3D({ parent: view3d.root });
        shadowOnly.disablePass('opaque');

        await expectCleanRender(app);
        expect(shadowless.renderPassMask).toBe(0);
        expect(shadowOnly.renderPassMask).toBe(0);
        expect(counts(), 'opaque, shadow and outline draw lists').toEqual([0, 0, 0]);

        const geometry = new CubeGeometry();
        const material = new FlatMaterial({ baseColor: 0xff2200 });
        shadowless.geometry = geometry;
        shadowless.material = material;
        shadowOnly.geometry = geometry;
        shadowOnly.material = material;
        await expectCleanRender(app);
        expect(shadowless._lastRenderPass).toBe(RenderPassBit.OPAQUE | outline);
        expect(shadowOnly._lastRenderPass).toBe(RenderPassBit.SHADOW);
        expect(counts(), 'opaque, shadow and outline draw lists').toEqual([1, 1, 1]);

        shadowless.material = BaseMaterial3D.EMPTY;
        shadowOnly.geometry = Geometry3D.EMPTY;
        await expectCleanRender(app);
        expect(counts(), 'opaque, shadow and outline draw lists').toEqual([0, 0, 0]);

        shadowless.material = material;
        shadowOnly.geometry = geometry;
        await expectCleanRender(app);
        expect(shadowless._lastRenderPass, 'its settings survive a placeholder round trip').toBe(
          RenderPassBit.OPAQUE | outline,
        );
        expect(shadowOnly._lastRenderPass, 'its settings survive a placeholder round trip').toBe(RenderPassBit.SHADOW);
      } finally {
        app.destroy();
      }
    });

    it('morphs once given a morph geometry, and frees its weight slot when that geometry is swapped out', async () => {
      const { app, view3d } = await setup('placeholder-morph');

      try {
        const mesh = new Mesh3D({ material: new FlatMaterial({ baseColor: 0xff2200 }), parent: view3d.root });
        await expectCleanRender(app);

        mesh.geometry = morphTriangle(2);
        mesh.weights![1] = 0.5;
        await expectCleanRender(app);

        const morph = mesh._morph!;
        const lane =
          view3d._sceneBatch.storeBuffer.u32Data[mesh._storeIndex * MESH3D_STORE_STRIDE + MESH3D_LANE_MORPH_WEIGHT];
        const morphStore = app.renderer.renderPipes.view3d._morphStoreBuffer;

        expect(morph._slot).toBeGreaterThanOrEqual(0);
        expect(lane).toBe(morph._weightIndex);
        expect(morphStore.data[morph._weightIndex + 1]).toBeCloseTo(0.5);
        expect([...app.renderer.material3d._shaderCache.keys()].some((key) => key.includes('|morph'))).toBe(true);

        mesh.geometry = new CubeGeometry();
        await expectCleanRender(app);

        expect(mesh._morph).toBeUndefined();
        expect(morph._slot).toBe(-1);
        expect(morph._store).toBeNull();
        expect(view3d._morphedMeshes.items).not.toContain(mesh);
      } finally {
        app.destroy();
      }
    });
  });
}
